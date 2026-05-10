import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import Society from "@/models/Society";
import {
  getOldestDueDate,
  getBillPayFinalDate,
} from "../../../../utils/interestUtils";

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
    // Validate we have year+month to calculate billPayFinalDate correctly
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

    // Fetch society config for billDueDay and billPayFinalDay
    const society = await Society.findById(decoded.societyId)
      .select("config")
      .lean();
    const billDueDay = society?.config?.billDueDay || 10;
    const billPayFinalDay = society?.config?.billPayFinalDay || 0;
    const billPayFinalDate = getBillPayFinalDate(
      billYear,
      billMonth,
      billPayFinalDay,
    );

    const members = await Member.find({
      _id: { $in: memberIds },
      societyId: decoded.societyId,
    })
      .select("_id openingBalance openingPrincipal openingInterest")
      .lean();

    const memberMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = {
        openingBalance: m.openingBalance || 0,
        openingPrincipal: m.openingPrincipal || 0,
        openingInterest: m.openingInterest || 0,
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
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const ledgerBalance = lastTxn?.balanceAfterTransaction ?? openingBalance;

      const currentPeriodId = `${billYear}-${String(billMonth).padStart(2, "0")}`;
      const unpaidBills = await Bill.find({
        memberId,
        societyId: decoded.societyId,
        status: { $in: ["Unpaid", "Overdue", "Partial"] },
        billPeriodId: { $ne: currentPeriodId },
      })
        .sort({ billYear: 1, billMonth: 1 })
        .lean();

      // If there are unpaid bills, use their balanceAmount sum as the authoritative previous balance.
      // The transaction ledger balance can diverge from unpaid bills (e.g. opening balances,
      // bills stored without full prev+interest in totalAmount). Unpaid bill balanceAmounts are
      // always the source of truth for what is actually owed.
      const unpaidBillsBalance = unpaidBills.reduce(
        (sum, b) => sum + (b.balanceAmount || 0),
        0,
      );
      const currentBalance =
        unpaidBillsBalance > 0 ? unpaidBillsBalance : ledgerBalance;

      let daysOverdue = 0;
      let oldestUnpaidDate = null;

      if (unpaidBills.length > 0) {
        oldestUnpaidDate = getOldestDueDate(
          unpaidBills,
          billDueDay,
          billYear,
          billMonth,
        );

        // Cap at billPayFinalDate if set — interest frozen after that day
        const effectiveEnd =
          billPayFinalDate && referenceDate > billPayFinalDate
            ? billPayFinalDate
            : referenceDate;

        daysOverdue = Math.max(
          0,
          Math.floor((effectiveEnd - oldestUnpaidDate) / (1000 * 60 * 60 * 24)),
        );
      } else if (openingBalance > 0 || openingPrincipal > 0) {
        // Opening balance exists but no bill history
        // Treat as due from prev month's billDueDay (society-configured, not hardcoded)
        oldestUnpaidDate = getOldestDueDate(
          [],
          billDueDay,
          billYear,
          billMonth,
        );

        // Cap at billPayFinalDate if set
        const effectiveEnd =
          billPayFinalDate && referenceDate > billPayFinalDate
            ? billPayFinalDate
            : referenceDate;

        daysOverdue = Math.max(
          0,
          Math.floor((effectiveEnd - oldestUnpaidDate) / (1000 * 60 * 60 * 24)),
        );
      }

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

      const totalPrincipalOutstanding = unpaidBills.length > 0
        ? unpaidBills.reduce((s, b) => s + (b.principalBalance || 0), 0)
        : openingPrincipal;
      const totalInterestOutstanding = unpaidBills.length > 0
        ? unpaidBills.reduce((s, b) => s + (b.interestBalance || 0), 0)
        : openingInterest;
      // Carry remInt for new bill generation (sum of all interestBalance = total remInt)
      const remInt = totalInterestOutstanding;

      balances[memberId] = {
        balance: currentBalance, // total outstanding (principal + interest)
        principalBalance: totalPrincipalOutstanding,
        interestBalance: totalInterestOutstanding,
        remInt, // pass to bill generation for monthInterest calc
        advanceCredit: memberId.advanceCredit || 0,
        daysOverdue,
        oldestUnpaidDate,
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
