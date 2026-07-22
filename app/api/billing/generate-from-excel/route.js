import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";

// Ledger V2: THIN WRAPPER over the shared GenerationService. No billing math
// of its own — charges/interest/totals come from generateBill(), which
// recomputes from BillingHeads. The uploaded Excel's `bills[]` is used only
// to select which members to generate for.
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { bills, billMonth, billYear } = await request.json();
    if (!bills?.length || billMonth === undefined || !billYear) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    const societyId = decoded.societyId;
    const month = billMonth + 1; // client sends 0-indexed month
    const billPeriodId = `${billYear}-${String(month).padStart(2, "0")}`;
    const existing = await Bill.findOne({ societyId, billPeriodId });
    if (existing)
      return NextResponse.json(
        { error: `Bills for ${billPeriodId} already exist` },
        { status: 409 },
      );

    const society = await Society.findById(societyId).lean();
    const created = [];
    const errors = [];

    for (const b of bills) {
      try {
        const bill = await generateBill({
          societyId,
          memberId: b.memberId,
          year: billYear,
          month,
          performedBy: decoded.userId,
        });

        const member = await Member.findById(b.memberId)
          .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary advanceCredit")
          .lean();
        const breakdown =
          bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
        const unpaidBills = await Bill.find({
          societyId,
          memberId: b.memberId,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
          billPeriodId: { $ne: billPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .lean();
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
          recentTransactions: [],
        });
        await Bill.updateOne(
          { _id: bill._id },
          { $set: { billHtml: renderResult.billHtml || renderResult.html } },
        );

        if (bill.status !== "Scheduled" && (member?.advanceCredit || 0) > 0) {
          const applied = Math.min(parseFloat(member.advanceCredit.toFixed(2)), bill.totalBillDue);
          if (applied > 0) {
            await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: decoded.userId });
            await Member.updateOne({ _id: b.memberId }, { $inc: { advanceCredit: -applied } });
          }
        }

        created.push(bill._id);
      } catch (err) {
        if (err.code === "P4_DUPLICATE") {
          errors.push({ memberId: b.memberId, error: `Bill already exists for ${billPeriodId}` });
        } else if (err.code === "MEMBER_NOT_FOUND") {
          errors.push({ memberId: b.memberId, error: "Member not found" });
        } else if (err.code && /^[BP]\d/.test(err.code)) {
          errors.push({ memberId: b.memberId, error: `Invariant ${err.code}: ${err.message}` });
        } else {
          console.error("generate-from-excel bill error", b.memberId, err.message);
          errors.push({ memberId: b.memberId, error: err.message });
        }
      }
    }

    await cache.del(`billing:generated:${societyId}`);
    await cache.del(`payments:outstanding:${societyId}`);
    await cache.del("admin:stats:global");
    return NextResponse.json({
      success: true,
      count: created.length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("generate-from-excel error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
