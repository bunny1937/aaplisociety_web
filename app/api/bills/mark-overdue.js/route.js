import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
/**
 * Cron job to mark bills as overdue
 * This is SEPARATE from interest calculation
 */
export async function POST(request) {
  const token = request.cookies.get("admin_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await connectDB();
    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== "SuperAdmin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // existing overdue update logic
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // ✅ Find bills that are unpaid/partial and past due date
    const overdueBills = await Bill.find({
      status: { $in: ["Unpaid", "Partial"] },
      dueDate: { $lt: today },
      balanceAmount: { $gt: 0 },
      isDeleted: false,
    });
    // ✅ Explicit bulk update
    const updatePromises = overdueBills.map((bill) => {
      bill.status = "Overdue";
      bill.lastModifiedAt = new Date();
      return bill.save();
    });
    await Promise.all(updatePromises);
    console.log(`✅ Marked ${overdueBills.length} bills as overdue`);
    return NextResponse.json({
      success: true,
      message: `${overdueBills.length} bills marked as overdue`,
      count: overdueBills.length,
    });
  } catch (error) {
    console.error("Mark overdue error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
