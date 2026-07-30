import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import {
  transitionFinancialYear,
  FinancialYearServiceError,
} from "@/lib/services/FinancialYearService";

// POST /api/accounting/financial-years/:id/transition
// Advances a Financial Year exactly one step forward through its 5-state
// workflow (Draft -> Reviewed -> Auditor Review -> Approved -> Locked).
// Admin/Secretary only — see docs/accounting-system-ARD.md §6.6.
export async function POST(request, ctx) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const { note } = await request.json().catch(() => ({}));
    const fy = await transitionFinancialYear({
      societyId: auth.user.societyId,
      id,
      byUserId: auth.user.userId,
      byRole: auth.user.role,
      note,
    });
    return NextResponse.json({ financialYear: fy });
  } catch (error) {
    if (error instanceof FinancialYearServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Transition financial year error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
