// app/api/visitor/cron/escalate/route.js
// GET/POST — Escalation sweeper. Protected by CRON_SECRET.
// Call every ~30s (Vercel Cron / external scheduler / node-cron in lib/cron-jobs).
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { runEscalationSweep } from "@/lib/escalation";
import { cronAuthorized } from "@/lib/v1/config";
function authorize(request) {
  // Endpoint stays disabled until CRON_SECRET is configured, then accepts
  // Bearer, raw Authorization, x-cron-secret, and ?secret= schedulers.
  if (!process.env.CRON_SECRET) return false;
  return cronAuthorized(request);
}
async function handle(request) {
  if (!authorize(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await connectDB();
    const result = await runEscalationSweep({ limit: 200 });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Escalation sweep error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function GET(request) {
  return handle(request);
}
export async function POST(request) {
  return handle(request);
}