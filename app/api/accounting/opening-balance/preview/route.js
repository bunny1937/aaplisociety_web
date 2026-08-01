import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting } from "@/lib/authz";
import {
  previewOpeningBalances,
  OpeningBalanceServiceError,
} from "@/lib/services/OpeningBalanceService";

// POST /api/accounting/opening-balance/preview — computes the balancing figure
// and proposed lines without posting. Body: { entries, openingFundAccountId }.
export async function POST(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const body = await request.json();
    const preview = await previewOpeningBalances(auth.user.societyId, {
      entries: body.entries,
      openingFundAccountId: body.openingFundAccountId,
    });
    return NextResponse.json({ preview });
  } catch (error) {
    if (error instanceof OpeningBalanceServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Opening balance preview error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
