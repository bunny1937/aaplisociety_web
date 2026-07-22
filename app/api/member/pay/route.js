import { NextResponse } from "next/server";

// Member self-pay disabled — all payments are reconciled via admin Excel
// upload. (Previously this handler had a full allocation implementation
// below an unconditional early return, making it permanently unreachable
// dead code — removed rather than converted, since it never ran.)
export async function POST() {
  return NextResponse.json(
    { error: "Online payment is not available. Please contact your society admin." },
    { status: 403 },
  );
}
