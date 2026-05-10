import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import Receipt from "@/models/Receipt";
import { getFinancialYear } from "@/lib/date-utils";
import {
  allocatePaymentInterestFirst,
  getBillPayFinalDate,
} from "../../../../utils/interestUtils";
import Society from "@/models/Society";
export async function POST(request) {
  // Member self-pay disabled — all payments are reconciled via admin Excel upload.
  return NextResponse.json(
    { error: "Online payment is not available. Please contact your society admin." },
    { status: 403 }
  );
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const {
      billIds,
      paymentMode = "Online",
      amount,
      notes = "",
    } = await request.json();

    if (!billIds || billIds.length === 0)
      return NextResponse.json({ error: "Bill IDs required" }, { status: 400 });

    const bills = await Bill.find({
      _id: { $in: billIds },
      memberId: decoded.memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
    });

    if (bills.length === 0)
      return NextResponse.json(
        { error: "No payable bills found" },
        { status: 400 },
      );

    const member = await Member.findById(decoded.memberId).lean();
    const lastTxn = await Transaction.findOne({
      memberId: decoded.memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();
    let currentBalance =
      lastTxn?.balanceAfterTransaction ?? member?.openingBalance ?? 0;

    // After fetching bills, sort oldest-first
    bills.sort((a, b) => {
      if (a.billYear !== b.billYear) return a.billYear - b.billYear;
      return a.billMonth - b.billMonth;
    });

    // ✅ Check BillPayFinalDate for member route too
    const society = await Society.findById(decoded.societyId)
      .select("config")
      .lean();
    const billPayFinalDay = society?.config?.billPayFinalDay || 0;
    if (billPayFinalDay > 0) {
      const oldest = bills[0];
      const finalDate = getBillPayFinalDate(
        oldest.billYear,
        oldest.billMonth,
        billPayFinalDay,
      );
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (finalDate && today > finalDate) {
        return NextResponse.json(
          {
            error: `Payment window closed. Contact admin for period ${oldest.billPeriodId}.`,
          },
          { status: 400 },
        );
      }
    }

    // Normalize balanceAmount to include previousBalance FIRST
    bills.forEach((b) => {
      // Snapshot original previousBalance BEFORE any mutation
      b._originalPreviousBalance = b.previousBalance ?? 0;

      // True remaining due
      b.balanceAmount = parseFloat(
        Math.max(0, (b.totalAmount ?? 0) - (b.amountPaid ?? 0)).toFixed(2),
      );

      const sumParts = parseFloat(
        (
          (b.principalBalance ?? 0) +
          (b.interestBalance ?? 0) +
          (b.previousBalance ?? 0)
        ).toFixed(2),
      );
      if (Math.abs(sumParts - b.balanceAmount) > 0.05) {
        b.interestBalance = Math.min(b.interestAmount ?? 0, b.balanceAmount);
        b.previousBalance = Math.min(
          b._originalPreviousBalance,
          Math.max(0, b.balanceAmount - b.interestBalance),
        );
        b.principalBalance = Math.max(
          0,
          parseFloat(
            (b.balanceAmount - b.interestBalance - b.previousBalance).toFixed(
              2,
            ),
          ),
        );
      }
    });

    const fullDue = bills.reduce((s, b) => s + b.balanceAmount, 0);
    const totalPayAmt =
      amount && amount > 0 && amount <= fullDue ? amount : fullDue;
    // ✅ Interest-first allocation
    const { billUpdates, breakdown, advanceCredit } =
      allocatePaymentInterestFirst(
        totalPayAmt,
        bills,
        society?.config?.adjustmentApplicationMode || "INTEREST_FIRST",
      );

    // Store original amountPaid before mutation for receipt calculation
    const originalAmountPaid = {};
    const originalPreviousBalance = {};
    for (const update of billUpdates) {
      const bill = bills.find((b) => String(b._id) === String(update.billId));
      if (!bill) continue;
      originalAmountPaid[String(bill._id)] = bill.amountPaid || 0;
      originalPreviousBalance[String(bill._id)] =
        bill._originalPreviousBalance ?? 0;
      const balanceBeforePayment = bill.balanceAmount;

      bill.interestBalance = update.newInterestBalance;
      bill.principalBalance = update.newPrincipalBalance;
      bill.previousBalance = update.newPreviousBalance;
      bill.balanceAmount = update.newBalanceAmount;
      bill.status = update.newStatus;
      bill.lastModifiedAt = new Date();

      const clearedThisPayment = parseFloat(
        (balanceBeforePayment - update.newBalanceAmount).toFixed(2),
      );
      bill.amountPaid = parseFloat(
        (
          (originalAmountPaid[String(bill._id)] || 0) + clearedThisPayment
        ).toFixed(2),
      );
      await bill.save();
    }

    if (advanceCredit > 0) {
      await Member.findByIdAndUpdate(decoded.memberId, {
        $inc: { advanceCredit },
      });
    }

    const newBalance = currentBalance - totalPayAmt;
    const transactionId = Transaction.generateTransactionId();

    await Transaction.create({
      transactionId,
      date: new Date(),
      memberId: decoded.memberId,
      societyId: decoded.societyId,
      type: "Credit",
      category: "Payment",
      description: `Member self-payment via ${paymentMode}${notes ? ` — ${notes}` : ""}`,
      amount: totalPayAmt,
      balanceAfterTransaction: newBalance,
      paymentMode,
      createdBy: decoded.userId,
      financialYear: getFinancialYear(new Date()),
      paymentBreakdown: breakdown,
    });

    const showBreakdown =
      society?.config?.memberPaymentBreakdownVisible !== false;

    // Receipt per bill (keep existing receipt logic, just loop over billUpdates)
    const receipts = [];
    for (const update of billUpdates) {
      const bill = bills.find((b) => String(b._id) === String(update.billId));
      if (!bill) continue;
      const receiptNo = `RCP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const nameParts = (member.ownerName || "member").trim().split(/\s+/);
      const nameSlug =
        nameParts.length > 1
          ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
          : nameParts[0];
      const flatSlug = `${member.wing || ""}-${member.flatNo || ""}`;
      const filename =
        `${nameSlug}_${flatSlug}_${bill.billPeriodId}_receipt`.replace(
          /[^a-zA-Z0-9_\-]/g,
          "_",
        );

      const receipt = await Receipt.create({
        receiptNo,
        filename,
        billId: bill._id,
        billPeriodId: bill.billPeriodId,
        memberId: decoded.memberId,
        societyId: decoded.societyId,
        amount: bill.amountPaid - (originalAmountPaid[String(bill._id)] || 0),
        previousBalanceSnapshot: originalPreviousBalance[String(bill._id)] ?? 0,
        paymentMode,
        paidAt: new Date(),
        transactionId,
        notes,
        status: "Generated",
      });
      receipts.push({
        receiptId: receipt._id,
        receiptNo,
        filename,
        billPeriodId: bill.billPeriodId,
      });
    }

    return NextResponse.json({
      success: true,
      message: "Payment recorded successfully",
      receipts,
      ...(showBreakdown ? { breakdown } : {}),
    });
  } catch (error) {
    console.error("Member pay error:", error);
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}
