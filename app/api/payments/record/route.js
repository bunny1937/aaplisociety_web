import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Bill from "@/models/Bill"; // ✅ ADDED
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getFinancialYear } from "@/lib/date-utils";
import AuditLog from "@/models/AuditLog";
import { calculateBillStatusAfterPayment } from "@/lib/bill-status-manager";
import {
  allocatePaymentInterestFirst,
  getBillPayFinalDate,
} from "../../../../utils/interestUtils";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const {
      memberId,
      amount,
      paymentMode,
      paymentDate,
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
    } = await request.json();

    if (!memberId || !amount) {
      return NextResponse.json(
        { error: "Member ID and amount are required" },
        { status: 400 },
      );
    }
    if (!paymentMode) {
      return NextResponse.json(
        { error: "Payment mode is required" },
        { status: 400 },
      );
    }
    if (amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than zero" },
        { status: 400 },
      );
    }

    const member = await Member.findOne({
      _id: memberId,
      societyId: decoded.societyId,
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Guard: reject payment from MEMBER portal if past billPayFinalDay.
    // Admin / Secretary must be able to record late payments.
    const society = await Society.findById(decoded.societyId)
      .select("config")
      .lean();
    const billPayFinalDay = society?.config?.billPayFinalDay || 0;

    if (billPayFinalDay > 0 && decoded.role === "Member") {
      const oldestBill = await Bill.findOne({
        memberId,
        societyId: decoded.societyId,
        status: { $in: ["Unpaid", "Partial", "Overdue"] },
        isDeleted: false,
      })
        .sort({ billYear: 1, billMonth: 1 })
        .lean();

      if (oldestBill) {
        const finalDate = getBillPayFinalDate(
          oldestBill.billYear,
          oldestBill.billMonth + 1, // billMonth is 0-indexed; getBillPayFinalDate expects 1-indexed
          billPayFinalDay,
        );
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (finalDate && today > finalDate) {
          return NextResponse.json(
            {
              error: `Payment not accepted. The payment deadline for bill period ${String(
                oldestBill.billMonth + 1,
              ).padStart(
                2,
                "0",
              )}/${oldestBill.billYear} was ${finalDate.toLocaleDateString(
                "en-IN",
              )}. Please contact the admin to process this payment.`,
            },
            { status: 400 },
          );
        }
      }
    }

    // ✅ Guard: reject payment if today is past billPayFinalDay for the oldest unpaid bill's month
    // const society = await Society.findById(decoded.societyId)
    //   .select("config")
    //   .lean();
    // const billPayFinalDay = society?.config?.billPayFinalDay || 0;

    // if (billPayFinalDay > 0) {
    //   // Find oldest unpaid bill to get its month context
    //   const oldestBill = await Bill.findOne({
    //     memberId,
    //     societyId: decoded.societyId,
    //     status: { $in: ["Unpaid", "Partial", "Overdue"] },
    //     isDeleted: false,
    //   })
    //     .sort({ billYear: 1, billMonth: 1 })
    //     .lean();

    //   if (oldestBill) {
    //     const finalDate = getBillPayFinalDate(
    //       oldestBill.billYear,
    //       oldestBill.billMonth,
    //       billPayFinalDay,
    //     );
    //     const today = new Date();
    //     today.setHours(0, 0, 0, 0);

    //     if (finalDate && today > finalDate) {
    //       return NextResponse.json(
    //         {
    //           error: `Payment not accepted. The payment deadline for bill period ${String(oldestBill.billMonth).padStart(2, "0")}/${oldestBill.billYear} was ${finalDate.toLocaleDateString("en-IN")}. Please contact the admin to process this payment.`,
    //         },
    //         { status: 400 },
    //       );
    //     }
    //   }
    // }

    // ... (keep auth, member fetch, billPayFinalDate guard unchanged) ...

    // ✅ Get unpaid bills oldest-first
    const unpaidBills = await Bill.find({
      memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue", "Scheduled"] },
      isDeleted: false,
    }).sort({ billYear: 1, billMonth: 1 });

    const hasOpeningBalance =
      (member.openingPrincipal || 0) + (member.openingInterest || 0) > 0;

    const memberTotalPayable =
      unpaidBills.reduce((s, b) => s + (b.balanceAmount || 0), 0) +
      (member.openingPrincipal || 0) +
      (member.openingInterest || 0);

    if (memberTotalPayable <= 0 && unpaidBills.length === 0) {
      return NextResponse.json(
        { error: "No outstanding bills found for this member" },
        { status: 400 },
      );
    }

    // If no bills but has opening balance, create a synthetic bill for allocation
    if (unpaidBills.length === 0 && hasOpeningBalance) {
      // Allocate against opening balance using interest-first
      const openingInt = parseFloat((member.openingInterest || 0).toFixed(2));
      const openingPrin = parseFloat((member.openingPrincipal || 0).toFixed(2));
      const paid = parseFloat(amount);

      let intCleared = Math.min(paid, openingInt);
      let remaining = parseFloat((paid - intCleared).toFixed(2));
      let prinCleared = Math.min(remaining, openingPrin);
      let advance = parseFloat((remaining - prinCleared).toFixed(2));

      // Reduce opening balances on Member
      const newOpeningInt = parseFloat((openingInt - intCleared).toFixed(2));
      const newOpeningPrin = parseFloat((openingPrin - prinCleared).toFixed(2));
      await Member.findByIdAndUpdate(memberId, {
        $set: {
          openingInterest: Math.max(0, newOpeningInt),
          openingPrincipal: Math.max(0, newOpeningPrin),
        },
        ...(advance > 0 ? { $inc: { advanceCredit: advance } } : {}),
      });

      // Record ledger transaction
      const lastTxn = await Transaction.findOne({
        memberId,
        societyId: decoded.societyId,
        isReversed: false,
      })
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const prevBal =
        lastTxn?.balanceAfterTransaction ?? member.openingBalance ?? 0;
      const newBal = parseFloat((prevBal - paid).toFixed(2));

      const txn = await Transaction.create({
        transactionId: Transaction.generateTransactionId(),
        date: paymentDate ? new Date(paymentDate) : new Date(),
        memberId,
        societyId: decoded.societyId,
        type: "Credit",
        category: "Payment",
        description: `Payment received (opening balance) via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
        amount: paid,
        balanceAfterTransaction: newBal,
        paymentMode: paymentMode || "Cash",
        chequeNo,
        bankName,
        upiId,
        transactionRef,
        notes,
        createdBy: decoded.userId,
        financialYear: getFinancialYear(new Date()),
        paymentBreakdown: {
          interestCleared: intCleared,
          principalCleared: prinCleared,
          advanceCredit: advance,
        },
      });

      const breakdown = {
        interestCleared: intCleared,
        principalCleared: prinCleared,
        advanceCredit: advance,
      };
      return NextResponse.json(
        {
          success: true,
          message: "Payment recorded successfully against opening balance",
          transaction: {
            transactionId: txn.transactionId,
            amount: paid,
            previousBalance: prevBal,
            newBalance: newBal,
            breakdown,
            advanceCredit: advance > 0 ? advance : undefined,
          },
        },
        { status: 201 },
      );
    }

    // ✅ Migrate legacy bills that have balanceAmount but no principalBalance/interestBalance split
    // This handles bills generated before the new engine was deployed
    const normalizedBills = unpaidBills.map((b) => {
      const bill = b.toObject ? b.toObject() : { ...b };
      if (
        (bill.principalBalance || 0) === 0 &&
        (bill.interestBalance || 0) === 0 &&
        (bill.balanceAmount || 0) > 0
      ) {
        // Use monthInterest as the interest basis (not interestAmount which may be stale)
        const intBal = parseFloat(
          (bill.monthInterest || bill.interestAmount || 0).toFixed(2),
        );
        const prinBal = parseFloat(
          Math.max(0, bill.balanceAmount - intBal).toFixed(2),
        );
        bill.interestBalance = intBal;
        bill.principalBalance = prinBal;
      }
      return bill;
    });

    // ✅ INTEREST-FIRST ALLOCATION (replaces FIFO)
    const {
      billUpdates,
      totalInterestCleared,
      totalPrincipalCleared,
      advanceCredit,
      breakdown,
    } = allocatePaymentInterestFirst(
      parseFloat(amount),
      normalizedBills,
      society?.config?.adjustmentApplicationMode || "INTEREST_FIRST",
    );

    // Persist bill updates
    const billsUpdated = [];
    for (const update of billUpdates) {
      const bill = unpaidBills.find(
        (b) => String(b._id) === String(update.billId),
      );
      if (!bill) continue;

      bill.interestBalance = update.newInterestBalance;
      bill.principalBalance = update.newPrincipalBalance;
      bill.balanceAmount = update.newBalanceAmount;
      bill.amountPaid = update.newAmountPaid;
      bill.status = update.newStatus;
      bill.lastModifiedAt = new Date();
      bill.lastModifiedBy = decoded.userId;
      await bill.save();

      billsUpdated.push({
        billId: bill._id,
        billPeriod: bill.billPeriodId,
        interestCleared: parseFloat(update.interestCleared),
        principalCleared: parseFloat(update.principalCleared),
        newStatus: bill.status,
      });
    }

    // ✅ Store advance credit on member if overpayment
    if (advanceCredit > 0) {
      await Member.findByIdAndUpdate(memberId, {
        $inc: { advanceCredit },
      });
    }

    // ✅ Get current ledger balance for transaction
    const lastTransaction = await Transaction.findOne({
      memberId,
      societyId: decoded.societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    let currentLedgerBalance =
      lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;

    const paymentAmount = parseFloat(amount);
    const newLedgerBalance = currentLedgerBalance - paymentAmount;

    // ✅ RECORD PAYMENT TRANSACTION
    const transaction = await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      date: paymentDate ? new Date(paymentDate) : new Date(),
      memberId,
      societyId: decoded.societyId,
      type: "Credit",
      category: "Payment",
      description: `Payment received via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
      amount: paymentAmount,
      balanceAfterTransaction: newLedgerBalance,
      paymentMode: paymentMode || "Cash",
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
      createdBy: decoded.userId,
      financialYear: getFinancialYear(new Date()),
      // Store breakdown for transparency
      paymentBreakdown: breakdown,
    });

    // ✅ AUDIT LOG
    await AuditLog.create({
      userId: decoded.userId,
      societyId: decoded.societyId,
      action: "RECORD_PAYMENT",
      newData: {
        memberId,
        memberName: member.ownerName,
        roomNo: member.roomNo,
        wing: member.wing,
        amount: paymentAmount,
        paymentMode,
        previousBalance: currentLedgerBalance,
        newBalance: newLedgerBalance,
        billsUpdated,
        breakdown,
      },
      timestamp: new Date(),
    });

    // ✅ Get society config for breakdown visibility
    const societyConfig = society?.config || {};
    const showBreakdown = societyConfig.memberPaymentBreakdownVisible !== false;

    return NextResponse.json(
      {
        success: true,
        message: "Payment recorded successfully",
        transaction: {
          transactionId: transaction.transactionId,
          amount: paymentAmount,
          previousBalance: currentLedgerBalance,
          newBalance: newLedgerBalance,
          billsUpdated,
          // Only expose breakdown if society config allows
          ...(showBreakdown ? { breakdown } : {}),
          advanceCredit: advanceCredit > 0 ? advanceCredit : undefined,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Record payment error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
