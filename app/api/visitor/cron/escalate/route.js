// app/api/visitor/cron/escalate/route.js
// GET/POST — Escalation sweeper. Protected by CRON_SECRET.
// Call every ~30s (Vercel Cron / external scheduler / node-cron in lib/cron-jobs).
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { runEscalationSweep } from "@/lib/escalation";
function authorize(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured to enable the endpoint
  const header =
    request.headers.get("authorization") || request.headers.get("x-cron-secret") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === secret;
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
