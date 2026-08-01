import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import { getBalanceSheet, FinancialStatementsServiceError } from "@/lib/services/FinancialStatementsService";

// GET /api/accounting/financial-statements/balance-sheet?financialYearId=
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const statement = await getBalanceSheet(auth.user.societyId, searchParams.get("financialYearId"));
    return NextResponse.json({ statement });
  } catch (error) {
    if (error instanceof FinancialStatementsServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Balance Sheet error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
