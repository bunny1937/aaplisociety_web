import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
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
    const { bills, billMonth, billYear, dueDate } = await request.json();
    if (!bills?.length || billMonth === undefined || !billYear || !dueDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;
    const existing = await Bill.findOne({
      societyId: decoded.societyId,
      billPeriodId,
    });
    if (existing)
      return NextResponse.json(
        { error: `Bills for ${billPeriodId} already exist` },
        { status: 409 },
      );
    const society = await Society.findById(decoded.societyId).lean();
    const billTemplate = society?.billTemplate;
    const created = [];
    for (const bill of bills) {
      const member = await Member.findById(bill.memberId)
        .select(
          "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary openingBalance openingPrincipal openingInterest advanceCredit",
        )
        .lean();
      if (!member) continue;
      // Fetch live unpaid bills — NEVER trust Excel previousBalance (member may have paid since template was downloaded)
      const [, dbUnpaidBills] = await Promise.all([
        Promise.resolve(null),
        Bill.find({
          memberId: bill.memberId,
          societyId: decoded.societyId,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
          isDeleted: { $ne: true },
          billPeriodId: { $ne: billPeriodId }, // exclude current period being generated
        })
          .select(
            "balanceAmount dueDate billYear billMonth billPeriodId status totalAmount amountPaid principalBalance interestBalance",
          )
          .sort({ billYear: 1, billMonth: 1 })
          .lean(),
      ]);
      // Recompute live balance from immutable fields — balanceAmount may be stale
      const livePrevBalance = dbUnpaidBills.reduce(
        (sum, b) =>
          sum +
          Math.max(0, (b.principalBalance || 0) + (b.interestBalance || 0)),
        0,
      );
      const anyPriorBill = await Bill.findOne({
        memberId: bill.memberId,
        societyId: decoded.societyId,
        billPeriodId: { $ne: billPeriodId },
        isDeleted: { $ne: true },
      })
        .select("_id")
        .lean();
      // Use totalBillDue - amountPaid as the live remaining principal per bill
      // principalBalance alone is not enough if it was never split properly
      const prevRemPrincipal =
        dbUnpaidBills.length > 0
          ? dbUnpaidBills.reduce((s, b) => {
              // If principalBalance was set properly, use it; else derive from totalBillDue - interestBalance - amountPaid
              const prinBal =
                b.principalBalance > 0
                  ? b.principalBalance
                  : Math.max(
                      0,
                      (b.totalBillDue || b.totalAmount || 0) -
                        (b.interestBalance || 0) -
                        (b.amountPaid || 0),
                    );
              return s + prinBal;
            }, 0)
          : anyPriorBill
            ? 0
            : member?.openingPrincipal || 0;
      const prevRemInt =
        dbUnpaidBills.length > 0
          ? dbUnpaidBills.reduce((s, b) => s + (b.interestBalance || 0), 0)
          : anyPriorBill
            ? 0
            : member?.openingInterest || 0;
      const _prevBalance =
        dbUnpaidBills.length > 0
          ? livePrevBalance
          : anyPriorBill
            ? 0
            : parseFloat(
                (
                  (member.openingPrincipal || 0) + (member.openingInterest || 0)
                ).toFixed(2),
              );
      let billHtml = null;
      let interestAmount = bill.interestAmount ?? 0;
      try {
        const renderResult = renderBillHtml(
          billTemplate?.html || "DEFAULT",
          society,
          member,
          {
            breakdown: bill.charges,
            totalAmount: bill.grandTotal,
            previousBalance: _prevBalance,
            prevRemPrincipal,
            prevRemInt,
            newBalance: livePrevBalance + bill.grandTotal,
            billPeriod: billPeriodId,
            billDate: new Date(billYear, billMonth, 1),
            dueDate: new Date(dueDate),
            unpaidBills: dbUnpaidBills,
            recentTransactions: bill.recentTransactions || [],
          },
        );
        billHtml = renderResult.billHtml;
        // Server recalculates using real DB unpaid bill dueDates — same as excel-template route
        // This guarantees Bills-all export and BillTemplate download always show the same interest
        interestAmount =
          renderResult.interestAmount ?? bill.interestAmount ?? 0;
      } catch (e) {
        /* continue without HTML — keep Excel interestAmount as fallback */
      }
      const _isScheduled = false;
      const _currentCharges = parseFloat(
        (bill.subtotal || bill.grandTotal || 0).toFixed(2),
      );
      const _currentInterest = parseFloat((interestAmount || 0).toFixed(2));
      const _openingPrincipal = parseFloat(prevRemPrincipal.toFixed(2));
      const _openingInterest = parseFloat(prevRemInt.toFixed(2));
      const _billPrincipalBalance = parseFloat(
        (_openingPrincipal + _currentCharges).toFixed(2),
      );
      const _billInterestBalance = parseFloat(
        (_openingInterest + _currentInterest).toFixed(2),
      );
      const _totalBillDue = parseFloat(
        (_billPrincipalBalance + _billInterestBalance).toFixed(2),
      );
      const _advanceCredit = parseFloat((member.advanceCredit || 0).toFixed(2));
      const _advanceApplied = parseFloat(
        Math.min(_advanceCredit, _totalBillDue).toFixed(2),
      );
      const _balanceAmount = parseFloat(
        Math.max(0, _totalBillDue - _advanceApplied).toFixed(2),
      );
      const doc = await Bill.create({
        billPeriodId,
        billMonth,
        billYear,
        memberId: member._id,
        societyId: decoded.societyId,
        charges: bill.charges,
        previousBalance: _prevBalance,
        interestAmount,
        subtotal: bill.grandTotal, // current charges only (no prev/interest)
        serviceTax: 0,
        currentBillTotal: bill.grandTotal,
        openingPrincipal: _openingPrincipal,
        openingInterest: _openingInterest,
        currentCharges: _currentCharges,
        currentInterest: _currentInterest,
        billPrincipalBalance: _billPrincipalBalance,
        billInterestBalance: _billInterestBalance,
        totalBillDue: _totalBillDue,
        principalBalance: _billPrincipalBalance,
        interestBalance: _billInterestBalance,
        totalAmount: _totalBillDue,
        balanceAmount: _balanceAmount,
        advanceApplied: _advanceApplied,
        amountPaid: _advanceApplied,
        dueDate: new Date(dueDate),
        generatedAt: new Date(),
        generatedBy: decoded.userId,
        status: _isScheduled ? "Scheduled" : "Unpaid",
        scheduledPushDate: null,
        billHtml,
        importedFrom: "Excel",
        isDeleted: false,
      });
      created.push(doc);
    }
    await cache.del(`billing:generated:${decoded.societyId}`);
    await cache.del(`payments:outstanding:${decoded.societyId}`);
    await cache.del("admin:stats:global");
    return NextResponse.json({ success: true, count: created.length });
  } catch (err) {
    console.error("generate-from-excel error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
