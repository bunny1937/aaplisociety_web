import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import {
  calculateMonthlyInterest,
} from "../../../../utils/interestUtils";
import { safeConfigDate } from "../../../../utils/dateUtils";
import { calculateMemberCharges } from "../../../../lib/calculate-member-bill";
import { getFinancialYear } from "@/lib/date-utils";
function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}
// Writes one bill to DB using new immutable fields.
// Takes the same snapshot data shape the simulator returns.
export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const { year, month, memberId, openingPrincipal, openingInterest, generationDate } =
      await request.json();
    if (!year || !month || !memberId) {
      return NextResponse.json({ error: "year, month, memberId required" }, { status: 400 });
    }
    const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
    const existing = await Bill.findOne({
      memberId,
      societyId: decoded.societyId,
      billPeriodId,
      isDeleted: { $ne: true },
    }).lean();
    if (existing) {
      return NextResponse.json({ error: `Bill already exists for ${billPeriodId}` }, { status: 400 });
    }
    const [member, society, heads] = await Promise.all([
      Member.findById(memberId).select(
        "flatNo wing ownerName carpetAreaSqft openingPrincipal openingInterest openingBalance advanceCredit"
      ).lean(),
      Society.findById(decoded.societyId).lean(),
      BillingHead.find({ societyId: decoded.societyId, isActive: true, isDeleted: false })
        .sort({ order: 1 }).lean(),
    ]);
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const { breakdown, subtotal } = calculateMemberCharges(member, heads);
    // Opening balances: use caller-supplied values if provided (simulator mode),
    // else derive from DB (previous month's closing state).
    let _openingPrincipal = openingPrincipal != null
      ? twoDp(openingPrincipal)
      : null;
    let _openingInterest = openingInterest != null
      ? twoDp(openingInterest)
      : null;
    if (_openingPrincipal == null) {
      // Derive from previous month's closing state
      const prevBillPeriod = month === 1
        ? `${year - 1}-12`
        : `${year}-${String(month - 1).padStart(2, "0")}`;
      const prevBill = await Bill.findOne({
        memberId,
        societyId: decoded.societyId,
        billPeriodId: prevBillPeriod,
        isDeleted: { $ne: true },
      }).select("closingPrincipal closingInterest billPrincipalBalance billInterestBalance principalBalance interestBalance").lean();
      if (prevBill) {
        _openingPrincipal = twoDp(prevBill.closingPrincipal ?? prevBill.billPrincipalBalance ?? prevBill.principalBalance ?? 0);
        _openingInterest = twoDp(prevBill.closingInterest ?? prevBill.billInterestBalance ?? prevBill.interestBalance ?? 0);
      } else {
        // First-ever bill — use member opening balances
        _openingPrincipal = twoDp(member.openingPrincipal || 0);
        _openingInterest = twoDp(member.openingInterest || 0);
      }
    }
    const interestRate = society?.config?.interestRate || 0;
    const interestRounding = society?.config?.interestRounding || "TWO_DECIMAL";
    let currentInterest = 0;
    if (_openingPrincipal > 0 || _openingInterest > 0) {
      const { currInt } = calculateMonthlyInterest({
        remainingPrincipal: _openingPrincipal,
        remInt: 0,
        annualRate: interestRate,
        interestRounding,
      });
      currentInterest = twoDp(currInt);
    }
    const dueDate = safeConfigDate(year, month, society?.config?.billDueDay || 10);
    const currentCharges = twoDp(subtotal);
    const billPrincipalBalance = twoDp(_openingPrincipal + currentCharges);
    const billInterestBalance = twoDp(_openingInterest + currentInterest);
    const totalBillDue = twoDp(billPrincipalBalance + billInterestBalance);
    const billPushDay = society?.config?.billPushDay || 1;
    const pushDate = safeConfigDate(year, month, billPushDay);
    const isScheduled = new Date() < pushDate;
    const bill = await Bill.create({
      billPeriodId,
      billMonth: month - 1,
      billYear: year,
      memberId,
      societyId: decoded.societyId,
      openingPrincipal: _openingPrincipal,
      openingInterest: _openingInterest,
      currentCharges,
      currentInterest,
      billPrincipalBalance,
      billInterestBalance,
      totalBillDue,
      // Legacy compat
      previousBalance: 0,
      previousPrincipal: _openingPrincipal,
      previousInterest: _openingInterest,
      currInt: currentInterest,
      monthInterest: twoDp(_openingInterest + currentInterest),
      interestAmount: twoDp(_openingInterest + currentInterest),
      subtotal: currentCharges,
      charges: new Map(Object.entries(breakdown || {}).map(([k, v]) => [k, parseFloat(v) || 0])),
      totalAmount: totalBillDue,
      amountPaid: 0,
      principalBalance: billPrincipalBalance,
      interestBalance: billInterestBalance,
      balanceAmount: totalBillDue,
      dueDate,
      status: isScheduled ? "Scheduled" : "Unpaid",
      scheduledPushDate: isScheduled ? pushDate : null,
      generatedBy: decoded.userId,
      generatedAt: new Date(),
      importedFrom: "System",
      isDeleted: false,
    });
    // Debit transaction
    const financialYear = getFinancialYear(referenceDate);
    await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      societyId: decoded.societyId,
      memberId,
      date: referenceDate,
      type: "Debit",
      category: "Maintenance",
      description: `Bill generated for ${billPeriodId} (simulator real-mode)`,
      amount: totalBillDue,
      balanceAfterTransaction: totalBillDue,
      paymentMode: "System",
      createdBy: decoded.userId,
      billPeriodId,
      financialYear,
    });
    return NextResponse.json({
      success: true,
      billId: bill._id,
      billPeriodId,
      openingPrincipal: _openingPrincipal,
      openingInterest: _openingInterest,
      currentCharges,
      currentInterest,
      billPrincipalBalance,
      billInterestBalance,
      totalBillDue,
      status: bill.status,
    });
  } catch (err) {
    console.error("generate-real error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
