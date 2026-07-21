import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { paymentSchema } from "@/lib/v1/schemas";
import { Bill, Member, Payment, Transaction, Receipt } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { allocatePaymentInterestFirst } from "@/lib/v1/business";
import { normalizeBill, newReceiptNo, newTransactionId, billBalances } from "@/lib/v1/billUtils";
import { periodLabelFrom } from "@/lib/v1/periodLabel";
import { notifyPaymentReceived } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/bills/:id/pay — admin/secretary records a payment against a bill.
// Interest is cleared before principal; any overpayment becomes member
// advanceCredit. Mirrors the mobile bill-pay controller (Payment + Transaction
// + Receipt written together).
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, BILLING_WRITE_ROLES);

  const body = await req.json().catch(() => ({}));
  const parsed = paymentSchema.partial({ billId: true }).safeParse({ ...body, billId: body.billId ?? id });
  if (!parsed.success) throw zodError(parsed);
  const { amount, paymentMode } = parsed.data;

  const bill = await Bill.findOne({ _id: id, societyId });
  if (!bill) throw new ApiError(404, "Bill not found");
  if (bill.status === "Paid") throw new ApiError(409, "Bill already paid");

  const bal = billBalances(bill);
  const { billUpdates, advanceCredit, breakdown } = allocatePaymentInterestFirst(amount, [
    {
      billId: String(bill._id),
      interestBalance: bal.interestBalance,
      principalBalance: bal.principalBalance,
      balanceAmount: bal.balanceAmount,
      totalAmount: bal.totalAmount,
      amountPaid: bal.amountPaid,
    },
  ]);
  const upd = billUpdates[0];

  bill.amountPaid = upd.newAmountPaid;
  bill.balanceAmount = upd.newBalanceAmount;
  bill.principalBalance = upd.newPrincipalBalance;
  bill.interestBalance = upd.newInterestBalance;
  bill.status = upd.newStatus;
  await bill.save();

  const receiptNo = newReceiptNo();
  const transactionId = newTransactionId();
  const label = periodLabelFrom(bill);

  const [payment, transaction, receipt] = await Promise.all([
    Payment.create({ societyId, billId: bill._id, memberId: bill.memberId, amount, paymentMode }),
    Transaction.create({
      transactionId,
      date: new Date(),
      societyId,
      memberId: bill.memberId,
      createdBy: claims.userId,
      type: "Credit",
      category: "Maintenance",
      description: `Payment received for ${label}`,
      amount,
      referenceId: bill._id,
      referenceModel: "Bill",
      billPeriodId: bill.billPeriodId ?? bill.period,
      paymentMode,
      interestCleared: Number(breakdown.interestCleared),
      principalCleared: Number(breakdown.principalCleared),
      paymentBreakdown: breakdown,
    }),
    Receipt.create({
      receiptNo,
      billId: bill._id,
      billPeriodId: bill.billPeriodId ?? bill.period,
      memberId: bill.memberId,
      societyId,
      amount,
      paymentMode,
      paidAt: new Date(),
      transactionId,
      status: "Generated",
    }),
  ]);

  if (advanceCredit > 0) {
    await Member.updateOne({ _id: bill.memberId }, { $inc: { advanceCredit } });
  }

  await notifyPaymentReceived({ transactionId: transaction._id, societyId, memberId: bill.memberId, amount });

  const member = await Member.findById(bill.memberId).lean();
  return json({
    bill: normalizeBill(bill, member),
    payment: { _id: String(payment._id), amount, paymentMode },
    receipt: { _id: String(receipt._id), receiptNo },
    advanceCredit,
    breakdown,
  });
});
