import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { cronAuthorized } from "@/lib/v1/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flips Scheduled bills whose scheduledPushDate has arrived into Unpaid, so
// residents only ever see a bill once it has actually been pushed.
//
// Exposed as BOTH GET and POST: external schedulers (cron-job.org) issue GET by
// default, which is why this returned 405 Method Not Allowed. It also had no
// authentication at all, so anyone could flip every scheduled bill to Unpaid.
async function handle(req) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
    return NextResponse.json({ success: true, pushed: result.modifiedCount });
  } catch (error) {
    console.error("[PUSH-SCHEDULED] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
