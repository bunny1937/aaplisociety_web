import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";

export async function GET(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  if (!societyId || !mongoose.Types.ObjectId.isValid(societyId)) {
    return NextResponse.json({ error: "Valid societyId required" }, { status: 400 });
  }

  await connectDB();
  const sid = new mongoose.Types.ObjectId(societyId);

  const [society, memberCount, billCount, txnCount, billStats] = await Promise.all([
    Society.findById(sid).select("-__v").lean(),
    Member.countDocuments({ societyId: sid, isDeleted: { $ne: true } }),
    Bill.countDocuments({ societyId: sid, isDeleted: { $ne: true } }),
    Transaction.countDocuments({ societyId: sid }),
    Bill.aggregate([
      { $match: { societyId: sid, isDeleted: { $ne: true } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          totalPaid: { $sum: "$amountPaid" },
        },
      },
    ]),
  ]);

  if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

  const members = await Member.find({ societyId: sid, isDeleted: { $ne: true } })
    .select("flatNo wing ownerName isActive")
    .sort({ wing: 1, flatNo: 1 })
    .lean();

  return NextResponse.json({
    success: true,
    society,
    stats: { members: memberCount, bills: billCount, transactions: txnCount },
    billStats,
    members,
  });
}
