import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import {
  createFinancialYear,
  listFinancialYears,
  FinancialYearServiceError,
} from "@/lib/services/FinancialYearService";

// GET /api/accounting/financial-years — list all Financial Years for the caller's society.
export async function GET(request) {
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const financialYears = await listFinancialYears(auth.user.societyId);
    return NextResponse.json({ financialYears });
  } catch (error) {
    console.error("List financial years error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}

// POST /api/accounting/financial-years — create a new Financial Year.
// Admin/Secretary only (not Accountant) — creating/deleting periods is a
// higher-stakes action than day-to-day accounting entries.
export async function POST(request) {
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { label, startDate, endDate } = await request.json();
    const fy = await createFinancialYear({
      societyId: auth.user.societyId,
      label,
      startDate,
      endDate,
      createdBy: auth.user.userId,
    });
    return NextResponse.json({ financialYear: fy }, { status: 201 });
  } catch (error) {
    if (error instanceof FinancialYearServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Create financial year error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
