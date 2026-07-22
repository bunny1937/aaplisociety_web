/**
 * POST /api/superadmin/fix-history-bills
 * Body: { societyId, beforePeriodId?, reason }  <-- reason is REQUIRED
 *
 * Ledger V2 (§8 / §17(2)): the audited correction-of-history workflow. Historical
 * imported bills (importedFrom=BulkImport, or strictly before beforePeriodId) that
 * still carry non-zero balances are settled to Paid — but NEVER via a silent
 * updateMany. Each bill is corrected through correctBillHistorical(), which writes
 * a MANUAL_CORRECTION audit event (before/after) in the same atomic operation.
 * A meaningful, explicit reason is mandatory — there is no generic default.
 * Idempotent: a bill that already has a MANUAL_CORRECTION event is skipped.
 *
 * GET returns the current unpaid bill summary so you can see what's still live.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import AuditEvent from "@/models/AuditEvent";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { correctBillHistorical } from "@/lib/billing/correctionService";

export async function GET(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;
  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });
  await connectDB();
  const sid = new mongoose.Types.ObjectId(societyId);
  const unpaid = await Bill.find({
    societyId: sid,
    status: { $in: ["Unpaid", "Partial", "Overdue"] },
    isDeleted: { $ne: true },
  })
    .select("billPeriodId status balanceAmount principalBalance interestBalance importedFrom memberId")
    .populate("memberId", "flatNo wing")
    .sort({ billPeriodId: 1 })
    .lean();
  return NextResponse.json({
    count: unpaid.length,
    bills: unpaid.map((b) => ({
      period: b.billPeriodId,
      flat: `${b.memberId?.wing}-${b.memberId?.flatNo}`,
      status: b.status,
      balanceAmount: b.balanceAmount,
      importedFrom: b.importedFrom || "live",
    })),
  });
}

export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;
  const { societyId, beforePeriodId, reason } = await request.json();
  if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });

  // A specific, meaningful reason is mandatory for every correction batch.
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (!cleanReason) {
    return NextResponse.json(
      { error: "A specific 'reason' is required to correct historical bills. Generic defaults are not allowed." },
      { status: 400 },
    );
  }

  await connectDB();
  const sid = new mongoose.Types.ObjectId(societyId);

  const orClauses = [{ importedFrom: "BulkImport" }];
  if (beforePeriodId) orClauses.push({ billPeriodId: { $lt: beforePeriodId } });

  const bills = await Bill.find({
    societyId: sid,
    isDeleted: { $ne: true },
    $and: [
      { $or: orClauses },
      {
        $or: [
          { status: { $in: ["Unpaid", "Partial", "Overdue"] } },
          { balanceAmount: { $gt: 0 } },
          { principalBalance: { $gt: 0 } },
          { interestBalance: { $gt: 0 } },
        ],
      },
    ],
  });

  const corrected = {
    status: "Paid",
    balanceAmount: 0,
    closingPrincipal: 0,
    closingInterest: 0,
    closingTotal: 0,
    principalBalance: 0,
    interestBalance: 0,
  };

  let correctedCount = 0;
  let skippedCount = 0;
  const results = [];
  for (const bill of bills) {
    const existing = await AuditEvent.findOne({ billId: bill._id, eventType: "MANUAL_CORRECTION" }).lean();
    if (existing) {
      skippedCount++;
      results.push({ billId: bill._id, skipped: "already_corrected" });
      continue;
    }
    await correctBillHistorical({
      bill,
      corrected,
      reason: cleanReason,
      performedBy: "SuperAdmin",
    });
    correctedCount++;
    results.push({ billId: bill._id, corrected: true });
  }

  return NextResponse.json({
    success: true,
    matched: bills.length,
    corrected: correctedCount,
    skipped: skippedCount,
    reason: cleanReason,
    message: `Corrected ${correctedCount} historical bill(s) with audit trail; skipped ${skippedCount} already-corrected.`,
    results,
  });
}
