import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { calculateMemberCharges } from "@/lib/calculate-member-bill";
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role !== "Admin")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    const { memberId, carpetAreaSqft, parkingSlots, recalcBillPeriodId } = await request.json();
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
    const patch = {};
    if (carpetAreaSqft !== undefined) patch.carpetAreaSqft = Number(carpetAreaSqft);
    if (parkingSlots !== undefined) patch.parkingSlots = parkingSlots;
    const member = await Member.findOneAndUpdate(
      { _id: memberId, societyId: decoded.societyId },
      { $set: patch },
      { new: true },
    );
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    await cache.delPattern(`members:list:${decoded.societyId}:*`);
    let billRecalculated = false;
    if (recalcBillPeriodId) {
      const existingBill = await Bill.findOne({
        memberId,
        societyId: decoded.societyId,
        billPeriodId: recalcBillPeriodId,
        isDeleted: { $ne: true },
      });
      if (existingBill) {
        const heads = await BillingHead.find({
          societyId: decoded.societyId,
          isActive: true,
          isDeleted: false,
        }).sort({ order: 1 }).lean();
        const { subtotal, breakdown } = calculateMemberCharges(member.toObject(), heads);
        const newCurrentCharges = parseFloat(subtotal.toFixed(2));
        const prevPrincipal = parseFloat((existingBill.openingPrincipal || 0).toFixed(2));
        const prevInterest = parseFloat((existingBill.openingInterest || 0).toFixed(2));
        const currInt = parseFloat((existingBill.currentInterest ?? existingBill.interestAmount ?? 0).toFixed(2));
        const newBillPrincipal = parseFloat((prevPrincipal + newCurrentCharges).toFixed(2));
        const newBillInterest = parseFloat((prevInterest + currInt).toFixed(2));
        const newTotalBillDue = parseFloat((newBillPrincipal + newBillInterest).toFixed(2));
        const alreadyPaid = parseFloat((existingBill.amountPaid || 0).toFixed(2));
        const advApplied = parseFloat((existingBill.advanceApplied || 0).toFixed(2));
        const newBalance = parseFloat(Math.max(0, newTotalBillDue - alreadyPaid - advApplied).toFixed(2));
        const newStatus = newBalance <= 0.005 ? "Paid" : alreadyPaid > 0 || advApplied > 0 ? "Partial" : "Unpaid";
        await Bill.findByIdAndUpdate(existingBill._id, {
          $set: {
            currentCharges: newCurrentCharges,
            subtotal: newCurrentCharges,
            currentBillTotal: newCurrentCharges,
            billPrincipalBalance: newBillPrincipal,
            billInterestBalance: newBillInterest,
            totalBillDue: newTotalBillDue,
            totalAmount: newTotalBillDue,
            balanceAmount: newBalance,
            status: newStatus,
            charges: new Map(Object.entries(breakdown).map(([k, v]) => [k, parseFloat(v) || 0])),
          },
        });
        billRecalculated = true;
      }
    }
    return NextResponse.json({ member: member.toObject(), billRecalculated });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
