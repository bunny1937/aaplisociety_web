import { NextResponse } from "next/server";
export async function POST(request) {
  // ❌ DISABLED — system uses monthly bill-time interest only.
  // Daily interest accrual removed per new billing model.
  return NextResponse.json(
    {
      success: false,
      message:
        "Daily interest cron disabled. Interest is calculated monthly at bill generation.",
    },
    { status: 410 },
  );
}
