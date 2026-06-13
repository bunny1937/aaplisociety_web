/**
 * POST /api/superadmin/fix-history-bills
 * Body: { societyId, beforePeriodId? }
 *
 * Zeroes out all historical imported bills (importedFrom=BulkImport OR any bill
 * strictly before beforePeriodId) that still have non-zero balances / wrong status.
 * The real carried-forward debt lives in Member.openingPrincipal — these bill docs
 * are audit records only, not live receivables.
 *
 * Safe to run multiple times (idempotent).
 *
 * GET returns current unpaid bill summary so you can see what's still live.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";

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

  const { societyId, beforePeriodId } = await request.json();
  if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });

  await connectDB();
  const sid = new mongoose.Types.ObjectId(societyId);

  // Match: importedFrom=BulkImport OR (beforePeriodId provided AND billPeriodId < beforePeriodId)
  const orClauses = [{ importedFrom: "BulkImport" }];
  if (beforePeriodId) {
    // billPeriodId is "YYYY-MM" string — lexicographic comparison works
    orClauses.push({ billPeriodId: { $lt: beforePeriodId } });
  }

  const result = await Bill.updateMany(
    {
      societyId: sid,
      isDeleted: { $ne: true },
      $or: orClauses,
      // Only touch bills that actually have wrong data
      $and: [
        {
          $or: [
            { status: { $in: ["Unpaid", "Partial", "Overdue"] } },
            { balanceAmount: { $gt: 0 } },
            { principalBalance: { $gt: 0 } },
            { interestBalance: { $gt: 0 } },
          ],
        },
      ],
    },
    {
      $set: {
        status: "Paid",
        balanceAmount: 0,
        principalBalance: 0,
        interestBalance: 0,
      },
    },
  );

  return NextResponse.json({
    success: true,
    matched: result.matchedCount,
    modified: result.modifiedCount,
    message: `Fixed ${result.modifiedCount} historical bill(s) — zeroed balances, set status=Paid`,
  });
}
