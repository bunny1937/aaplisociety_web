// Returns the latest REAL bill for a member so the bill-template designer can
// render an actual filled bill (instead of hardcoded sample numbers) before the
// admin activates a template.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireRoles } from "@/lib/authz";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import User from "@/models/User";
void User;

export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = requireRoles(request, ["Admin", "Secretary", "Treasurer"]);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const societyId = auth.user.societyId;
    let memberId = searchParams.get("memberId");

    if (!memberId) {
      const first = await Member.findOne({ societyId }).select("_id").lean();
      memberId = first?._id;
    }
    if (!memberId) return NextResponse.json({ bill: null, reason: "No members in this society" });

    const member = await Member.findOne({ _id: memberId, societyId })
      .select("ownerName flatNo wing areaSqFt carpetAreaSqft builtUpAreaSqft openingBalance")
      .lean();
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // Prefer a generated (pushed) bill; fall back to the newest of any status.
    const bill =
      (await Bill.findOne({ societyId, memberId, status: { $ne: "Scheduled" } })
        .sort({ billDate: -1, createdAt: -1 })
        .lean()) ||
      (await Bill.findOne({ societyId, memberId }).sort({ billDate: -1, createdAt: -1 }).lean());

    if (!bill) {
      return NextResponse.json({
        bill: null,
        reason: "This member has no bill generated yet",
        member: { ...member, _id: String(member._id) },
      });
    }

    // Normalise charge rows across the shapes bills have used over time.
    const charges =
      (bill.charges || bill.billItems || bill.heads || []).map((c) => ({
        name: c.name || c.headName || c.description || "Charge",
        amount: Number(c.amount ?? c.value ?? 0),
        rate: c.rate,
        perSqFt: Boolean(c.perSqFt || c.calculationType === "Per Sq Ft"),
        fixed: Boolean(c.fixed || c.calculationType === "Fixed"),
      })) || [];

    const due = bill.dueDate ? new Date(bill.dueDate) : null;
    const daysOverdue = due ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000)) : 0;

    return NextResponse.json({
      bill: {
        _id: String(bill._id),
        billPeriodId: bill.billPeriodId,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        status: bill.status,
        charges,
        previousBalance: Number(bill.previousBalance ?? bill.arrears ?? 0),
        interestAmount: Number(bill.interestAmount ?? bill.interest ?? 0),
        totalAmount: Number(bill.totalAmount ?? 0),
        amountPaid: Number(bill.amountPaid ?? 0),
        advanceApplied: Number(bill.advanceApplied ?? 0),
        daysOverdue,
        member: {
          ...member,
          _id: String(member._id),
          areaSqFt: member.areaSqFt ?? member.carpetAreaSqft ?? member.builtUpAreaSqft ?? 0,
        },
      },
    });
  } catch (err) {
    console.error("preview-bill error", err);
    return NextResponse.json({ error: err.message || "Failed to build preview" }, { status: 500 });
  }
}
