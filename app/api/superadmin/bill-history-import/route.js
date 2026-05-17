/**
 * POST /api/superadmin/bill-history-import
 * Receives pre-validated bill history data (client has already verified calculations).
 * Saves all bills to DB as historical records for audit.
 *
 * Body: { societyId, bills: [{ periodId, memberId, wing, flatNo, ...billFields }] }
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import AuditReport from "@/models/AuditReport";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";

export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  const body = await request.json();
  const { societyId, bills, joinPeriodId } = body;

  if (!societyId || !Array.isArray(bills) || !bills.length) {
    return NextResponse.json({ error: "societyId and bills[] required" }, { status: 400 });
  }

  await connectDB();

  const sid = mongoose.Types.ObjectId.createFromHexString(societyId.toString());
  const society = await Society.findById(sid).lean();
  if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

  // Build member lookup: wingFlat → member
  const members = await Member.find({ societyId: sid, isDeleted: { $ne: true } })
    .select("_id flatNo wing")
    .lean();
  const memberMap = {};
  for (const m of members) {
    const key = `${(m.wing || "").toLowerCase()}-${m.flatNo.toLowerCase()}`;
    memberMap[key] = m;
    // Also support no-wing key
    memberMap[m.flatNo.toLowerCase()] = m;
  }

  // Check for existing bills in these periods (prevent double import)
  const periodIds = [...new Set(bills.map((b) => b.periodId))];
  const existing = await Bill.countDocuments({
    societyId: sid,
    billPeriodId: { $in: periodIds },
    importedFrom: "BulkImport",
    isDeleted: { $ne: true },
  });
  if (existing > 0) {
    return NextResponse.json({
      error: `Historical bills already imported for periods: ${periodIds.join(", ")}. Delete them first.`,
    }, { status: 409 });
  }

  const batchId = new mongoose.Types.ObjectId().toHexString();
  const created = [];
  const errors = [];

  for (const b of bills) {
    const wingFlat = b.wingFlat || `${b.wing || ""}-${b.flatNo}`;
    const lookupKey = wingFlat.toLowerCase();
    const member = memberMap[lookupKey] || memberMap[lookupKey.split("-").slice(1).join("-")];

    if (!member) {
      errors.push({ periodId: b.periodId, wingFlat, error: "Member not found" });
      continue;
    }

    const [billYear, billMonthStr] = b.periodId.split("-").map(Number);
    const billMonth = billMonthStr - 1; // 0-indexed

    const dueDate = new Date(billYear, billMonth + 1, 0); // last day of month

    const charges = new Map();
    const CHARGE_COLS = [
      "Maintenance Charges", "Sinking Fund", "Repair Fund",
      "Water Charges", "Security Charges", "Electricity Charges",
      "Open Parking - Two Wheeler", "Open Parking - Four Wheeler",
      "Covered Parking - Two Wheeler", "Covered Parking - Four Wheeler",
    ];
    for (const col of CHARGE_COLS) {
      const val = parseFloat(b[col] || 0);
      if (val > 0) charges.set(col, val);
    }

    const currentCharges = parseFloat(b.CurrentCharges || 0);
    const openingPrincipal = parseFloat(b.OpeningPrincipal || 0);
    const openingInterest = parseFloat(b.OpeningInterest || 0);
    const currentInterest = parseFloat(b.CurrentInterest || 0);
    const billPrincipal = parseFloat(b.BillPrincipal || 0);
    const billInterest = parseFloat(b.BillInterest || 0);
    const totalBillDue = parseFloat(b.TotalBillDue || 0);
    const amountPaid = parseFloat(b.AmountPaid || 0);
    const advanceCredit = parseFloat(b.AdvanceCredit || 0);
    const remainingDue = parseFloat(b.RemainingDue || 0);
    const alreadyPaid = parseFloat(b.AlreadyPaid || 0);

    // Determine status from remaining due
    let status = "Paid";
    if (remainingDue > 0.01) {
      status = amountPaid > 0 || alreadyPaid > 0 ? "Partial" : "Unpaid";
    }

    // Closing balances: remaining = closingPrincipal + closingInterest (simplified split)
    // Interest paid first, then principal
    const interestPaidThisPeriod = Math.min(amountPaid + alreadyPaid, billInterest);
    const principalPaidThisPeriod = Math.max(0, (amountPaid + alreadyPaid) - interestPaidThisPeriod);
    const closingInterest = Math.max(0, billInterest - interestPaidThisPeriod);
    const closingPrincipal = Math.max(0, billPrincipal - principalPaidThisPeriod - advanceCredit);

    try {
      const bill = new Bill({
        societyId: sid,
        memberId: member._id,
        billPeriodId: b.periodId,
        billMonth,
        billYear,
        openingPrincipal,
        openingInterest,
        currentCharges,
        currentInterest,
        billPrincipalBalance: billPrincipal,
        billInterestBalance: billInterest,
        totalBillDue,
        closingPrincipal,
        closingInterest,
        closingTotal: closingPrincipal + closingInterest,
        previousBalance: openingPrincipal + openingInterest,
        previousPrincipal: openingPrincipal,
        previousInterest: openingInterest,
        monthInterest: currentInterest,
        interestAmount: currentInterest,
        principalBalance: billPrincipal,
        interestBalance: billInterest,
        totalAmount: totalBillDue,
        amountPaid: amountPaid + alreadyPaid,
        advanceApplied: advanceCredit,
        balanceAmount: remainingDue,
        charges,
        status,
        dueDate,
        importedFrom: "BulkImport",
        importBatchId: batchId,
        importMetadata: {
          fileName: "BillHistory",
          uploadedAt: new Date(),
          rowNumber: 0,
          validationStatus: "Valid",
        },
        notes: b.Remarks || "",
      });

      await bill.save();
      created.push({ periodId: b.periodId, wingFlat, billId: bill._id });
    } catch (err) {
      errors.push({ periodId: b.periodId, wingFlat, error: err.message });
    }
  }

  // Mark society onboarding complete
  await Society.findByIdAndUpdate(sid, {
    "onboarding.billHistoryImported": true,
    "onboarding.billHistoryImportedAt": new Date(),
    "onboarding.billHistoryPeriods": periodIds,
    ...(joinPeriodId ? { "onboarding.joinPeriodId": joinPeriodId } : {}),
  });

  // Create AuditReport record for superadmin audit-reports page
  try {
    const [joinYear, joinMonthStr] = (joinPeriodId || periodIds[periodIds.length - 1]).split("-").map(Number);
    const auditFrom = periodIds[0].split("-").map(Number);
    const auditTo = periodIds[periodIds.length - 1].split("-").map(Number);
    const memberCount = [...new Set(bills.map((b) => b.wingFlat || `${b.wing}-${b.flatNo}`))].length;

    await AuditReport.findOneAndUpdate(
      { societyId: sid },
      {
        societyId: sid,
        societyName: society.name,
        submittedBy: sid, // no user context in superadmin route; use societyId as placeholder
        submittedAt: new Date(),
        joinMonth: joinMonthStr,
        joinYear,
        auditFromMonth: auditFrom[1],
        auditFromYear: auditFrom[0],
        auditToMonth: auditTo[1],
        auditToYear: auditTo[0],
        totalMonthsRequired: periodIds.length,
        validation: {
          totalMembersExpected: memberCount,
          totalMembersFound: memberCount,
          totalRowsExpected: bills.length,
          totalRowsFound: created.length,
          passed: errors.length === 0,
          errors: errors.map((e) => `${e.periodId} ${e.wingFlat}: ${e.error}`),
          warnings: [],
        },
        status: "Approved",
        batchId,
      },
      { upsert: true, new: true },
    );
  } catch (auditErr) {
    console.error("[bill-history-import] AuditReport create failed:", auditErr.message);
  }

  return NextResponse.json({
    success: true,
    created: created.length,
    errors: errors.length,
    errorDetails: errors,
    batchId,
    periods: periodIds,
  });
}

// GET — auto-detect joinPeriodId from earliest bill for this society
export async function GET(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });

  await connectDB();
  const sid = mongoose.Types.ObjectId.createFromHexString(societyId.toString());

  // First bill = earliest billYear+billMonth
  const firstBill = await Bill.findOne({ societyId: sid, isDeleted: { $ne: true } })
    .sort({ billYear: 1, billMonth: 1 })
    .select("billPeriodId billYear billMonth")
    .lean();

  if (!firstBill) {
    return NextResponse.json({ joinPeriodId: null, source: "no_bills" });
  }

  const joinPeriodId = firstBill.billPeriodId;

  // Persist it so we don't re-detect next time
  await Society.findByIdAndUpdate(sid, { "onboarding.joinPeriodId": joinPeriodId });

  return NextResponse.json({ joinPeriodId, source: "first_bill" });
}

// PATCH — manually set joinPeriodId
export async function PATCH(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  const { societyId, joinPeriodId } = await request.json();
  if (!societyId || !joinPeriodId) {
    return NextResponse.json({ error: "societyId and joinPeriodId required" }, { status: 400 });
  }
  await connectDB();
  const sid = mongoose.Types.ObjectId.createFromHexString(societyId.toString());
  await Society.findByIdAndUpdate(sid, { "onboarding.joinPeriodId": joinPeriodId });
  return NextResponse.json({ success: true });
}
