import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import Society from "@/models/Society";
import { computePreviousBalances } from "../../../../utils/billingEngine";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await request.json();
    const { memberIds, billYear, billMonth, billDate } = body;
    if (!billYear || !billMonth) {
      return NextResponse.json(
        { error: "billYear and billMonth are required" },
        { status: 400 },
      );
    }
    if (!memberIds || !Array.isArray(memberIds)) {
      return NextResponse.json(
        { error: "Invalid member IDs" },
        { status: 400 },
      );
    }

    // Reference date = 1st of the bill period being generated
    // daysOverdue is calculated relative to this, NOT today
    const referenceDate = billDate
      ? new Date(billDate)
      : billYear && billMonth
        ? new Date(billYear, billMonth, 1)
        : new Date();

    const members = await Member.find({
      _id: { $in: memberIds },
      societyId: decoded.societyId,
    })
      .select(
        "_id openingBalance openingPrincipal openingInterest advanceCredit",
      )
      .lean();

    const memberMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = {
        openingBalance: m.openingBalance || 0,
        openingPrincipal: m.openingPrincipal || 0,
        openingInterest: m.openingInterest || 0,
        advanceCredit: m.advanceCredit || 0,
      };
    });

    const balances = {};

    for (const memberId of memberIds.filter(Boolean)) {
      const memberData = memberMap[memberId.toString()] || {};
      const openingBalance = memberData.openingBalance || 0;
      const openingPrincipal = memberData.openingPrincipal || 0;
      const openingInterest = memberData.openingInterest || 0;

      const lastTxn = await Transaction.findOne({
        memberId,
        societyId: decoded.societyId,
        isReversed: false,
        date: { $lt: referenceDate },
      })
        .sort({ createdAt: -1 })
        .lean();
      const ledgerBalance = lastTxn?.balanceAfterTransaction ?? openingBalance;

      const currentPeriodId = `${billYear}-${String(billMonth).padStart(2, "0")}`;
      const [unpaidBills, anyPriorBill] = await Promise.all([
        Bill.find({
          memberId,
          societyId: decoded.societyId,
          status: { $in: ["Unpaid", "Overdue", "Partial"] },
          billPeriodId: { $ne: currentPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .lean(),
        Bill.findOne({
          memberId,
          societyId: decoded.societyId,
          billPeriodId: { $ne: currentPeriodId },
          isDeleted: { $ne: true },
        })
          .select("_id")
          .lean(),
      ]);

      // Unpaid bill balanceAmounts are the source of truth for what is owed.
      // If member has prior bills and all paid → balance is 0 (not ledger, which can have orphan debits).
      // Only use ledgerBalance for new members with no bills ever.
      const unpaidBillsBalance = unpaidBills.reduce(
        (sum, b) => sum + (b.balanceAmount || 0),
        0,
      );
      const currentBalance =
        unpaidBillsBalance > 0
          ? unpaidBillsBalance
          : anyPriorBill
            ? 0
            : ledgerBalance;

      const transactions = await Transaction.find({
        memberId,
        societyId: decoded.societyId,
        isReversed: false,
      })
        .sort({ date: -1 })
        .limit(10)
        .select(
          "date type category description amount balanceAfterTransaction billPeriodId",
        )
        .lean();

      // Use centralized engine to derive previous outstanding balances.
      // Source of truth = balanceAmount on unpaid bills.
      // principalBalance is immutable (gross at generation) — never use it directly.
      const {
        principalOutstanding: totalPrincipalOutstanding,
        interestOutstanding: totalInterestOutstanding,
      } = computePreviousBalances(unpaidBills, anyPriorBill, {
        openingPrincipal,
        openingInterest,
      });
      // Carry remInt for new bill generation (sum of all interestBalance = total remInt)
      const remInt = totalInterestOutstanding;

      balances[memberId] = {
        balance: currentBalance,
        principalBalance: totalPrincipalOutstanding,
        interestBalance: totalInterestOutstanding,
        remInt,
        advanceCredit: memberData.advanceCredit || 0,
        unpaidBills: unpaidBills.map((b) => ({
          billPeriodId: b.billPeriodId,
          totalAmount: b.totalAmount,
          balanceAmount: b.balanceAmount,
          principalBalance: b.principalBalance || 0,
          interestBalance: b.interestBalance || 0,
          dueDate: b.dueDate,
          status: b.status,
        })),
        recentTransactions: transactions.map((t) => ({
          date: t.date,
          type: t.type,
          category: t.category,
          description: t.description,
          amount: t.amount,
          balance: t.balanceAfterTransaction,
          billPeriod: t.billPeriodId,
        })),
      };
    }

    return NextResponse.json({ success: true, balances });
  } catch (error) {
    console.error("❌ Get previous balances error:", error);

    if (
      error.message?.includes("ENOTFOUND") ||
      error.message?.includes("timeout")
    ) {
      console.warn("⚠️ MongoDB unreachable, returning zero balances");
      // memberIds already parsed — but body may not be in scope if error was before parse
      return NextResponse.json({ success: true, balances: {} });
    }

    return NextResponse.json(
      { error: "Failed to get previous balances", details: error.message },
      { status: 500 },
    );
  }
}
