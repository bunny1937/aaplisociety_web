import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Society from "@/models/Society";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";
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

    const { billMonth, billYear, dueDate, bills, forceRegenerate } =
      await request.json();
    if (billMonth === undefined || !billYear || !dueDate || !bills) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;

    // Block generation for periods that have locked historical bills
    const historicalExists = await Bill.findOne({
      societyId: decoded.societyId,
      billPeriodId,
      $or: [{ isHistoricalArchive: true }, { importedFrom: "BulkImport" }, { isLocked: true }],
      isDeleted: { $ne: true },
    });
    if (historicalExists) {
      return NextResponse.json(
        {
          error: `Cannot generate bills for ${billPeriodId} — this period has locked historical (imported) records. Historical bills are immutable audit records.`,
          isHistoricalPeriod: true,
        },
        { status: 409 },
      );
    }

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
        let prevRemPrincipal = 0;
        let prevRemInt = 0;
        if (member) {
          try {
            const [, _dbUnpaidBills] = await Promise.all([
              Promise.resolve(null),
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

            // anyPriorBill: did this member ever have a bill before?
            // If yes + all paid → outstanding = 0, NOT member opening balances.
            // Only use member opening balances for brand-new members (no prior bills ever).
            const anyPriorBill = await Bill.findOne({
              memberId: bill.memberId,
              societyId: decoded.societyId,
              billPeriodId: { $ne: billPeriodId },
              isDeleted: { $ne: true },
            })
              .select("_id")
              .lean();

            // Use centralized engine — source of truth is balanceAmount on unpaid bills
            const {
              principalOutstanding: _prevPrincipal,
              interestOutstanding: _prevInterest,
            } = computePreviousBalances(dbUnpaidBills, anyPriorBill, {
              openingPrincipal: member?.openingPrincipal || 0,
              openingInterest: member?.openingInterest || 0,
            });
            prevRemPrincipal = _prevPrincipal;
            prevRemInt = _prevInterest;

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
          // ── Immutable bill-state fields ──────────────────────────────────
          ...(() => {
            const _op = parseFloat(prevRemPrincipal.toFixed(2));
            const _oi = parseFloat(prevRemInt.toFixed(2));
            const _cc = parseFloat(
              (bill.subtotal || bill.currentBillTotal || 0).toFixed(2),
            );
            const _ci = parseFloat((renderedCurrInt || 0).toFixed(2));
            const _bp = parseFloat((_op + _cc).toFixed(2));
            const _bi = parseFloat((_oi + _ci).toFixed(2));
            const _total = parseFloat((_bp + _bi).toFixed(2));
            const _adv = parseFloat((bill.advanceCredit || 0).toFixed(2));
            const _advApplied = parseFloat(Math.min(_adv, _total).toFixed(2));
            const _balance = parseFloat(
              Math.max(0, _total - _advApplied).toFixed(2),
            );
            // principalBalance/interestBalance = gross (for allocator correctness)
            // balanceAmount = net after advance credit (what member actually owes)
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
              balanceAmount: _balance,
              advanceApplied: _advApplied,
              _advanceApplied: _advApplied,
              amountPaid: _advApplied, // ← MOVED INSIDE IIFE where _advApplied is in scope
              status: _balance <= 0.005 ? "Paid" : _advApplied > 0 ? "Partial" : "Unpaid",
            };
          })(),

          subtotal: bill.subtotal || bill.currentBillTotal || 0,
          serviceTax: bill.serviceTax || 0,
          currentBillTotal: bill.currentBillTotal || bill.subtotal || 0,
          // amountPaid: _advApplied,        ← REMOVED (was out of scope)
          dueDate: new Date(dueDate),
          generatedAt: new Date(),
          generatedBy: decoded.userId,
          scheduledPushDate: null,
          billHtml,
          importedFrom: "System",
          isDeleted: false,
        };
      }),
    );

    // Collect advance credit consumption before stripping temp field
    const advanceToConsume = new Map();
    for (const b of billsToCreate) {
      if (b._advanceApplied > 0) {
        advanceToConsume.set(String(b.memberId), b._advanceApplied);
      }
      delete b._advanceApplied;
    }

    const createdBills = await Bill.insertMany(billsToCreate);

    // Decrement advanceCredit on members where it was applied
    for (const [memberId, applied] of advanceToConsume) {
      await Member.findByIdAndUpdate(memberId, {
        $inc: { advanceCredit: -applied },
      });
    }

    // Zero out historical BulkImport bills that were absorbed into openingPrincipal.
    // Only target importedFrom=BulkImport — live Partial bills are real receivables
    // and must NOT be zeroed (their balanceAmount is the source of truth for the next bill's openingPrincipal).
    for (const bill of createdBills) {
      if ((bill.openingPrincipal || 0) > 0 || (bill.openingInterest || 0) > 0) {
        await Bill.updateMany(
          {
            memberId: bill.memberId,
            societyId: decoded.societyId,
            billPeriodId: { $lt: billPeriodId },
            balanceAmount: { $gt: 0.005 },
            importedFrom: "BulkImport",
            isDeleted: { $ne: true },
          },
          {
            $set: {
              balanceAmount: 0,
              principalBalance: 0,
              interestBalance: 0,
              status: "Paid",
              lastModifiedAt: new Date(),
            },
          },
        );
      }
    }


    // Create a ledger debit transaction per bill so running balance is correct
    for (const bill of createdBills) {
      const lastTxn = await Transaction.findOne({
        memberId: bill.memberId,
        societyId: decoded.societyId,
        isReversed: false,
      })
        .sort({ createdAt: -1 })
        .lean();

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
