import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import User from "@/models/User";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Receipt from "@/models/Receipt";
import Transaction from "@/models/Transaction";
import BillingHead from "@/models/BillingHead";

// POST /api/superadmin/delete-society
// Body: { societyId }
// Hard-deletes society + all associated data
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    await connectDB();

    const { societyId } = await request.json();
    if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });

    const society = await Society.findById(societyId).lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    const [bills, receipts, transactions, members, billingHeads, users] = await Promise.all([
      Bill.deleteMany({ societyId }),
      Receipt.deleteMany({ societyId }),
      Transaction.deleteMany({ societyId }),
      Member.deleteMany({ societyId }),
      BillingHead.deleteMany({ societyId }),
      User.deleteMany({ societyId }),
    ]);

    await Society.findByIdAndDelete(societyId);

    return NextResponse.json({
      success: true,
      societyName: society.name,
      deleted: {
        bills: bills.deletedCount,
        receipts: receipts.deletedCount,
        transactions: transactions.deletedCount,
        members: members.deletedCount,
        billingHeads: billingHeads.deletedCount,
        users: users.deletedCount,
      },
    });
  } catch (err) {
    console.error("delete-society error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
