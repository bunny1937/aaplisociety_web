import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Complaint from "@/models/Complaint";

// Internal cron-only route — no auth header needed since it's local
export async function POST() {
  try {
    await connectDB();
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const result = await Complaint.updateMany(
      {
        status: "REJECTED",
        $or: [
          { lastReplyAt: { $lt: cutoff } },
          { lastReplyAt: null, updatedAt: { $lt: cutoff } },
        ],
      },
      { $set: { status: "CLOSED" } },
    );

    return NextResponse.json({ success: true, closed: result.modifiedCount });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
