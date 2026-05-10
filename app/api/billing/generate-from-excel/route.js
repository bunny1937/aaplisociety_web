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
          "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary openingBalance openingPrincipal openingInterest",
        )
        .lean();
      if (!member) continue;

      // Fetch previous bill HTML for page 3 reference
      // Fetch live unpaid bills — NEVER trust Excel previousBalance (member may have paid since template was downloaded)
      const [prevBill, dbUnpaidBills] = await Promise.all([
        Bill.findOne({
          memberId: bill.memberId,
          societyId: decoded.societyId,
          billHtml: { $exists: true, $ne: null },
        })
          .sort({ billYear: -1, billMonth: -1 })
          .lean(),
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

      // Live previous balance — sum of all unpaid bill balances from DB
      const livePrevBalance = dbUnpaidBills.reduce(
        (sum, b) => sum + (b.balanceAmount || 0),
        0,
      );

      const prevRemPrincipal = dbUnpaidBills.length === 0
        ? member?.openingPrincipal || 0
        : dbUnpaidBills.reduce((s, b) => s + (b.principalBalance || 0), 0);
      const prevRemInt = dbUnpaidBills.length === 0
        ? member?.openingInterest || 0
        : dbUnpaidBills.reduce((s, b) => s + (b.interestBalance || 0), 0);

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
            previousBillHtml: prevBill?.billHtml || null,
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
      const _currentCharges = parseFloat((bill.subtotal || bill.grandTotal || 0).toFixed(2));
      const _currentInterest = parseFloat((interestAmount || 0).toFixed(2));
      const _openingPrincipal = parseFloat(prevRemPrincipal.toFixed(2));
      const _openingInterest = parseFloat(prevRemInt.toFixed(2));
      const _prevBalance = dbUnpaidBills.length > 0
        ? livePrevBalance
        : parseFloat(((member.openingPrincipal || 0) + (member.openingInterest || 0)).toFixed(2));
      const _billPrincipalBalance = parseFloat((_openingPrincipal + _currentCharges).toFixed(2));
      const _billInterestBalance = parseFloat((_openingInterest + _currentInterest).toFixed(2));
      const _totalBillDue = parseFloat((_billPrincipalBalance + _billInterestBalance).toFixed(2));

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
        balanceAmount: _totalBillDue,
        amountPaid: 0,
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
