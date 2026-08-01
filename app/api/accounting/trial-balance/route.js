import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getTrialBalance, TrialBalanceServiceError } from "@/lib/services/TrialBalanceService";

// GET /api/accounting/trial-balance?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const trialBalance = await getTrialBalance(auth.user.societyId, searchParams.get("financialYearId"));
    return NextResponse.json({ trialBalance });
  } catch (error) {
    if (error instanceof TrialBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Trial balance error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
