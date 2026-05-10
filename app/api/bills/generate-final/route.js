import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Society from "@/models/Society";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const { billMonth, billYear, dueDate, bills, forceRegenerate } = await request.json();
    if (billMonth === undefined || !billYear || !dueDate || !bills) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;

    // Check for duplicates
    const existing = await Bill.findOne({
      societyId: decoded.societyId,
      billPeriodId,
    });
    if (existing) {
      if (!forceRegenerate) {
        return NextResponse.json(
          { error: `Bills for ${billPeriodId} already exist`, canForce: true },
          { status: 409 },
        );
      }
      // Delete all existing bills and their debit ledger entries for this period
      await Bill.deleteMany({ societyId: decoded.societyId, billPeriodId });
      await Transaction.deleteMany({
        societyId: decoded.societyId,
        billPeriodId,
        type: "Debit",
        category: "Maintenance",
      });
    }

    // Load society + template ONCE
    const society = await Society.findById(decoded.societyId).lean();
    const billTemplate = society?.billTemplate;

    const billsToCreate = await Promise.all(
      bills.map(async (bill) => {
        // FIX 1: breakdown is now a plain object {name: amount}, not array
        const chargesSource = bill.breakdown || bill.charges || {};
        const charges = {};
        if (Array.isArray(chargesSource)) {
          chargesSource.forEach((c) => {
            if (c.name !== "Interest on Arrears") charges[c.name] = c.amount;
          });
        } else {
          Object.entries(chargesSource).forEach(([name, amount]) => {
            if (name !== "Interest on Arrears") charges[name] = amount;
          });
        }

        // FIX 2: frontend sends totalAmount not grandTotal
        const grandTotal = bill.totalAmount ?? bill.grandTotal ?? 0;

        const member = await Member.findById(bill.memberId)
          .select(
            "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary openingBalance openingPrincipal openingInterest",
          )
          .lean();

        let billHtml = null;
        let interestAmount = bill.interestAmount || 0;
        let renderedCurrInt = 0;
        let renderedMonthInterest = 0;
        let dbUnpaidBills = [];
        let prevRemPrincipal = member?.openingPrincipal || 0;
        let prevRemInt = member?.openingInterest || 0;
        if (member) {
          try {
            const [prevBill, _dbUnpaidBills] = await Promise.all([
              Bill.findOne(
                {
                  memberId: bill.memberId,
                  societyId: decoded.societyId,
                  billHtml: { $exists: true, $ne: null },
                },
                { billHtml: 1 },
                { sort: { billYear: -1, billMonth: -1 } },
              ).lean(),
              // Fetch actual unpaid bills from DB — same query as excel-template route
              // so renderBillHtml uses the real oldest dueDate, not a fallback
              Bill.find({
                memberId: bill.memberId,
                societyId: decoded.societyId,
                status: { $in: ["Unpaid", "Partial", "Overdue"] },
                isDeleted: { $ne: true },
              })
                .select(
                  "balanceAmount principalBalance interestBalance dueDate billYear billMonth billPeriodId status totalAmount amountPaid",
                )
                .sort({ billYear: 1, billMonth: 1 })
                .lean(),
            ]);

            dbUnpaidBills = _dbUnpaidBills;

            const oldestUnpaidDate =
              dbUnpaidBills.length > 0 && dbUnpaidBills[0].dueDate
                ? new Date(dbUnpaidBills[0].dueDate)
                : null;

            prevRemPrincipal =
              dbUnpaidBills.length === 0
                ? member?.openingPrincipal || 0
                : dbUnpaidBills.reduce((s, b) => s + (b.principalBalance || 0), 0);
            prevRemInt =
              dbUnpaidBills.length === 0
                ? member?.openingInterest || 0
                : dbUnpaidBills.reduce((s, b) => s + (b.interestBalance || 0), 0);

            const renderResult = renderBillHtml(
              billTemplate?.html || "DEFAULT",
              society,
              member,
              {
                breakdown: charges,
                totalAmount: grandTotal,
                previousBalance: bill.previousBalance || 0,
                prevRemPrincipal, // ← NEW: for calculateMonthlyInterest principal base
                prevRemInt, // ← NEW: for calculateMonthlyInterest remInt carry-forward
                newBalance: (bill.previousBalance || 0) + grandTotal,
                billPeriod: billPeriodId,
                billDate: new Date(billYear, billMonth, 1),
                dueDate: new Date(dueDate),
                unpaidBills:
                  dbUnpaidBills.length > 0
                    ? dbUnpaidBills
                    : bill.unpaidBills || [],
                oldestUnpaidDate,
                recentTransactions: bill.recentTransactions || [],
                previousBillHtml: prevBill?.billHtml || null,
              },
            );
            billHtml = renderResult.billHtml;
            interestAmount = renderResult.interestAmount ?? 0;
            renderedCurrInt = renderResult.currInt ?? 0;
            renderedMonthInterest =
              renderResult.monthInterest ?? interestAmount;
          } catch (err) {
            console.error(
              "renderBillHtml failed for",
              bill.memberId,
              err.message,
            );
          }
        }

        const _isScheduled = false;

        // Compute per-bill interest from previous bills' remInt
        // previousInterest = sum of interestBalance from all existing unpaid bills (passed in from excel template)
        const prevInterest = bill.previousInterest || 0;
        const prevPrincipal = bill.previousPrincipal || 0;

        return {
          billPeriodId,
          billMonth,
          billYear,
          memberId: bill.memberId,
          societyId: decoded.societyId,
          charges,

          // Previous carry-forward components
          previousBalance: bill.previousBalance || 0,
          previousPrincipal: prevPrincipal,
          previousInterest: prevInterest,

          // interestResult must come from calculateMonthlyInterest, not calculateInterestAmount
          // calculateMonthlyInterest returns { currInt, monthInterest }
          currInt: renderedCurrInt, // interest on THIS month's principal only
          monthInterest: renderedMonthInterest, // currInt + carried remInt (display only)
          interestAmount: renderedMonthInterest,
          // ── Immutable bill-state fields ──────────────────────────────────
          ...((() => {
            const _op = parseFloat(prevRemPrincipal.toFixed(2));
            const _oi = parseFloat(prevRemInt.toFixed(2));
            const _cc = parseFloat((bill.subtotal || bill.currentBillTotal || 0).toFixed(2));
            const _ci = parseFloat((renderedCurrInt || 0).toFixed(2));
            const _bp = parseFloat((_op + _cc).toFixed(2));
            const _bi = parseFloat((_oi + _ci).toFixed(2));
            const _total = parseFloat((_bp + _bi).toFixed(2));
            return {
              openingPrincipal: _op,
              openingInterest: _oi,
              currentCharges: _cc,
              currentInterest: _ci,
              billPrincipalBalance: _bp,
              billInterestBalance: _bi,
              totalBillDue: _total,
              principalBalance: _bp,
              interestBalance: _bi,
              totalAmount: _total,
              balanceAmount: _total,
            };
          })()),

          subtotal: bill.subtotal || bill.currentBillTotal || 0,
          serviceTax: bill.serviceTax || 0,
          currentBillTotal: bill.currentBillTotal || bill.subtotal || 0,
          amountPaid: 0,
          dueDate: new Date(dueDate),
          generatedAt: new Date(),
          generatedBy: decoded.userId,
          status: "Unpaid",
          scheduledPushDate: null,
          billHtml,
          importedFrom: "System",
          isDeleted: false,
        };
      }),
    );

    const createdBills = await Bill.insertMany(billsToCreate);
    console.log(`Generated ${createdBills.length} bills for ${billPeriodId}`);

    // Create a ledger debit transaction per bill so running balance is correct
    for (const bill of createdBills) {
      const lastTxn = await Transaction.findOne({
        memberId: bill.memberId,
        societyId: decoded.societyId,
        isReversed: false,
      }).sort({ date: -1, createdAt: -1 }).lean();

      const prevBal = parseFloat(
        (lastTxn?.balanceAfterTransaction ?? 0).toFixed(2),
      );
      const newBal = parseFloat((prevBal + bill.totalBillDue).toFixed(2));

      await Transaction.create({
        transactionId: Transaction.generateTransactionId(),
        date: bill.generatedAt || new Date(),
        memberId: bill.memberId,
        societyId: decoded.societyId,
        type: "Debit",
        category: "Maintenance",
        description: `Bill generated for ${billPeriodId}`,
        amount: bill.totalBillDue,
        balanceAfterTransaction: newBal,
        paymentMode: "System",
        referenceId: bill._id,
        referenceModel: "Bill",
        billPeriodId,
        createdBy: decoded.userId,
      });
    }

    await cache.delPattern(`billing:list:${decoded.societyId}:*`);
    await cache.del(`billing:generated:${decoded.societyId}`);
    await cache.del(`payments:outstanding:${decoded.societyId}`);
    await cache.del(`admin:stats:global`);
    return NextResponse.json({
      success: true,
      message: `Generated ${createdBills.length} bills successfully`,
      billPeriodId,
      count: createdBills.length,
    });
  } catch (error) {
    console.error("Generate final bills error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
