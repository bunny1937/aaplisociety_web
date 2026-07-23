import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";

// Ledger V2: THIN WRAPPER over the shared GenerationService. Contains no
// billing math of its own — charges/interest/totals are recomputed from
// BillingHeads inside generateBill(). The request body's `bills` array is
// used ONLY to select which members to generate for; any client-supplied
// amounts are ignored, same policy as /api/billing/generate.
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const {
      billMonth,
      billYear,
      bills,
      forceRegenerate,
      publishMode = "config",
      scheduledPushDate = null,
    } = await request.json();
    if (billMonth === undefined || !billYear || !bills) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    if (!["config", "now", "schedule"].includes(publishMode)) {
      return NextResponse.json({ error: "publishMode must be config, now, or schedule" }, { status: 400 });
    }
    if (publishMode === "schedule") {
      const d = new Date(scheduledPushDate);
      if (!scheduledPushDate || Number.isNaN(d.getTime()) || d <= new Date()) {
        return NextResponse.json({ error: "Choose a future scheduled push date" }, { status: 400 });
      }
    }
    const month = billMonth + 1; // client sends 0-indexed month
    const billPeriodId = `${billYear}-${String(month).padStart(2, "0")}`;
    const societyId = decoded.societyId;

    // Block generation for periods that have locked historical bills.
    const historicalExists = await Bill.findOne({
      societyId,
      billPeriodId,
      $or: [{ isHistoricalArchive: true }, { importedFrom: "BulkImport" }, { isLocked: true }],
      isDeleted: { $ne: true },
    });
    if (historicalExists) {
      return NextResponse.json(
        {
          error: `Cannot generate bills for ${billPeriodId} — this period has locked historical (imported) records. Historical bills are immutable audit records.`,
          isHistoricalPeriod: true,
        },
        { status: 409 },
      );
    }

    const existing = await Bill.findOne({ societyId, billPeriodId });
    if (existing) {
      if (!forceRegenerate) {
        return NextResponse.json(
          { error: `Bills for ${billPeriodId} already exist`, canForce: true },
          { status: 409 },
        );
      }
      // Explicit admin-confirmed regeneration — delete and recreate via the
      // same canonical engine, never patch financial values in place.
      await Bill.deleteMany({ societyId, billPeriodId });
      await Transaction.deleteMany({
        societyId,
        billPeriodId,
        type: "Debit",
        category: "Maintenance",
      });
    }

    const memberIds = [...new Set(bills.map((b) => String(b.memberId)).filter(Boolean))];
    if (!memberIds.length)
      return NextResponse.json({ error: "No members to generate for" }, { status: 400 });

    const society = await Society.findById(societyId).lean();

    const createdBills = [];
    const errors = [];

    for (const memberId of memberIds) {
      try {
        const bill = await generateBill({
          societyId,
          memberId,
          year: billYear,
          month,
          performedBy: decoded.userId,
          publishMode,
          scheduledFor: scheduledPushDate,
        });

        const member = await Member.findById(memberId)
          .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary advanceCredit openingBalance")
          .lean();
        const breakdown =
          bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
        const [unpaidBills, recentTransactions] = await Promise.all([
          Bill.find({
            societyId,
            memberId,
            status: { $in: ["Unpaid", "Partial", "Overdue"] },
            billPeriodId: { $ne: billPeriodId },
            isDeleted: { $ne: true },
          })
            .sort({ billYear: 1, billMonth: 1 })
            .lean(),
          Transaction.find({ societyId, memberId }).sort({ date: -1 }).limit(10).lean(),
        ]);
        const renderResult = renderBillHtml(null, society, member, {
          breakdown,
          totalAmount: bill.currentCharges,
          previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
          prevRemPrincipal: bill.openingPrincipal,
          prevRemInt: bill.openingInterest,
          precomputedCurrInt: bill.currentInterest,
          precomputedMonthInterest: bill.billInterestBalance,
          balanceAmount: bill.balanceAmount,
          status: bill.status,
          billPeriod: billPeriodId,
          billDate: new Date(billYear, billMonth, 1),
          dueDate: bill.dueDate,
          unpaidBills,
          recentTransactions,
        });
        await Bill.updateOne({ _id: bill._id }, { $set: { billHtml: renderResult.billHtml || renderResult.html } });

        const lastTxn = await Transaction.findOne({ memberId, societyId, isReversed: false })
          .sort({ date: -1, createdAt: -1 })
          .lean();
        const prevBal = parseFloat((lastTxn?.balanceAfterTransaction ?? member?.openingBalance ?? 0).toFixed(2));
        await Transaction.create({
          transactionId: Transaction.generateTransactionId(),
          date: bill.generatedAt || new Date(),
          memberId,
          societyId,
          type: "Debit",
          category: "Maintenance",
          description: `Bill generated for ${billPeriodId}`,
          amount: bill.totalBillDue,
          balanceAfterTransaction: parseFloat((prevBal + bill.totalBillDue).toFixed(2)),
          paymentMode: "System",
          referenceId: bill._id,
          referenceModel: "Bill",
          billPeriodId,
          createdBy: decoded.userId,
        });

        // Apply any stored advance credit THROUGH the AllocationEngine — no
        // independent advance math here. Skip Scheduled bills (not yet live).
        if (bill.status !== "Scheduled" && (member?.advanceCredit || 0) > 0) {
          const applied = Math.min(parseFloat(member.advanceCredit.toFixed(2)), bill.totalBillDue);
          if (applied > 0) {
            await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: decoded.userId });
            await Member.updateOne({ _id: memberId }, { $inc: { advanceCredit: -applied } });
          }
        }

        createdBills.push(bill._id);
      } catch (err) {
        if (err.code === "P4_DUPLICATE") {
          errors.push({ memberId, error: `Bill already exists for ${billPeriodId}` });
        } else if (err.code === "MEMBER_NOT_FOUND") {
          errors.push({ memberId, error: "Member not found" });
        } else if (err.code && /^[BP]\d/.test(err.code)) {
          errors.push({ memberId, error: `Invariant ${err.code}: ${err.message}` });
        } else {
          console.error(`Error creating bill for ${memberId}:`, err);
          errors.push({ memberId, error: err.message });
        }
      }
    }

    await cache.delPattern(`billing:list:${societyId}:*`);
    await cache.del(`billing:generated:${societyId}`);
    await cache.del(`payments:outstanding:${societyId}`);
    await cache.del(`admin:stats:global`);

    return NextResponse.json({
      success: true,
      message: `Generated ${createdBills.length} bill(s)`,
      billPeriodId,
      count: createdBills.length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      publishMode,
      scheduledPushDate: publishMode === "schedule" ? scheduledPushDate : null,
    });
  } catch (error) {
    console.error("Generate final bills error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}