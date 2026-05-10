import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { allocatePaymentInterestFirst } from "../../../../utils/interestUtils";
import { getFinancialYear } from "@/lib/date-utils";

function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

// Records a real payment against a specific bill period.
// Same allocation logic as upload-payments, but for a single member.
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

    const { memberId, billPeriodId, amount, paymentDate, paymentMethod, remarks } =
      await request.json();

    if (!memberId || !billPeriodId || !amount) {
      return NextResponse.json({ error: "memberId, billPeriodId, amount required" }, { status: 400 });
    }
    if (amount <= 0) {
      return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
    }

    const [member, society] = await Promise.all([
      Member.findById(memberId).lean(),
      Society.findById(decoded.societyId).select("config").lean(),
    ]);

    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    const unpaidBills = await Bill.find({
      memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
      isDeleted: { $ne: true },
    }).sort({ billYear: 1, billMonth: 1 });

    if (!unpaidBills.length) {
      return NextResponse.json({ error: "No unpaid bills found for this member" }, { status: 400 });
    }

    const allocationMode = society?.config?.adjustmentApplicationMode || "INTEREST_FIRST";

    const billsForAlloc = unpaidBills.map(b => ({
      _id: b._id,
      principalBalance: twoDp(b.billPrincipalBalance || b.principalBalance || 0),
      interestBalance: twoDp(b.billInterestBalance || b.interestBalance || 0),
      balanceAmount: twoDp(b.balanceAmount || 0),
      amountPaid: twoDp(b.amountPaid || 0),
      totalAmount: twoDp(b.totalBillDue || b.totalAmount || 0),
    }));

    const { billUpdates, totalInterestCleared, totalPrincipalCleared, advanceCredit } =
      allocatePaymentInterestFirst(twoDp(amount), billsForAlloc, allocationMode);

    const eps = 0.005;
    let primaryBillId = null;

    for (const upd of billUpdates) {
      const bill = unpaidBills.find(b => String(b._id) === String(upd.billId));
      if (!bill) continue;
      if (!primaryBillId) primaryBillId = bill._id;

      const newClosingPrincipal = twoDp(upd.newPrincipalBalance) < eps ? 0 : twoDp(upd.newPrincipalBalance);
      const newClosingInterest = twoDp(upd.newInterestBalance) < eps ? 0 : twoDp(upd.newInterestBalance);

      bill.principalBalance = newClosingPrincipal;
      bill.interestBalance = newClosingInterest;
      bill.balanceAmount = twoDp(newClosingPrincipal + newClosingInterest);
      bill.amountPaid = twoDp(upd.newAmountPaid);
      bill.status = upd.newStatus;
      bill.closingPrincipal = newClosingPrincipal;
      bill.closingInterest = newClosingInterest;
      bill.closingTotal = twoDp(newClosingPrincipal + newClosingInterest);
      bill.paymentUploadedAt = new Date();
      bill.lastModifiedAt = new Date();
      bill.lastModifiedBy = decoded.userId;
      await bill.save();
    }

    if (advanceCredit > 0) {
      await Member.findByIdAndUpdate(memberId, { $inc: { advanceCredit } });
    }

    const txDate = paymentDate ? new Date(paymentDate) : new Date();
    const lastTxn = await Transaction.findOne({
      memberId, societyId: decoded.societyId, isReversed: false,
    }).sort({ date: -1, createdAt: -1 }).lean();
    const prevBal = twoDp(lastTxn?.balanceAfterTransaction ?? member.openingBalance ?? 0);

    const txn = await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      date: txDate,
      memberId,
      societyId: decoded.societyId,
      type: "Credit",
      category: "Payment",
      description: `Payment via simulator (real mode) for ${billPeriodId}${remarks ? ` - ${remarks}` : ""}`,
      amount: twoDp(amount),
      interestCleared: twoDp(totalInterestCleared),
      principalCleared: twoDp(totalPrincipalCleared),
      balanceAfterTransaction: twoDp(prevBal - amount),
      paymentMode: paymentMethod || "Cash",
      notes: remarks,
      createdBy: decoded.userId,
      billPeriodId,
      financialYear: getFinancialYear(txDate),
      paymentBreakdown: {
        interestCleared: twoDp(totalInterestCleared),
        principalCleared: twoDp(totalPrincipalCleared),
        advanceCredit: twoDp(advanceCredit),
      },
    });

    return NextResponse.json({
      success: true,
      transactionId: txn.transactionId,
      billPeriodId,
      amountPaid: twoDp(amount),
      interestCleared: twoDp(totalInterestCleared),
      principalCleared: twoDp(totalPrincipalCleared),
      advanceCredit: twoDp(advanceCredit),
      primaryBillId,
    });
  } catch (err) {
    console.error("pay-real error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
