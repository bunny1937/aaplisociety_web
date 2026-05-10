import NextResponse from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";

export async function POST() {
  try {
    await connectDB();
    const now = new Date();
    now.setHours(23, 59, 59, 999); // include full day

    const result = await Bill.updateMany(
      {
        status: "Scheduled",
        scheduledPushDate: { $lte: now },
        isDeleted: { $ne: true },
      },
      { $set: { status: "Unpaid", scheduledPushDate: null } },
    );

    console.log(
      `[PUSH-SCHEDULED] Pushed ${result.modifiedCount} bills to Unpaid`,
    );
    return NextResponse.json({
      success: true,
      pushed: result.modifiedCount,
    });
  } catch (error) {
    console.error("[PUSH-SCHEDULED] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
