import FinancialYear from "@/models/FinancialYear";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// Phase 2.6 producer-wiring (docs/accounting-system-ARD.md §8 Phase-2.6 build
// note). Shared by every live payment-recording route so "no route posts a
// Journal Entry directly" holds for all of them.
//
// ── FIX: receivable vs. advance split ───────────────────────────────────
// This used to post the WHOLE payment as `amount`, and the default posting
// rules credited all of it to Member Receivable:
//
//     Dr Cash <amount> / Cr Member Receivable <amount>
//
// BillGenerated only ever debits Receivable with the NEW charge for the period
// (currentCharges + currentInterest — correctly, so carried-forward rupees
// aren't double-posted). So the moment a payment exceeded the dues actually
// raised, Receivable was credited for money that was never debited and the
// asset went negative: the reported `Member Receivable ₹-30,149.45`.
//
// The Trial Balance still said "Balanced ✓" because each voucher is internally
// balanced — Dr always equals Cr. A balanced Trial Balance can never detect a
// contra-natured account balance; that's what the Validation Rule Engine
// (§6.15) is for.
//
// Now the caller passes `appliedToDues` and `advance` (see
// lib/billing/paymentApplication.js#splitPaymentAgainstDues) and the payload
// carries both, so the seeded rules post:
//
//     Dr Cash/Bank        <amount>
//     Cr Member Receivable <appliedToDues>      (only what settles real dues)
//     Cr Advance From Members <advance>          (liability, optional line)
//
// which is exactly the statutory "Advance Recd. From Members" liability line.
export async function postPaymentToLedger(
  societyId,
  { transaction, paymentMode, paymentDate, notes, actorUserId, appliedToDues, advance, session } = {},
) {
  const config = await getFiscalConfig(societyId, session);
  if (!config.enabled) return null;

  const date = paymentDate ? new Date(paymentDate) : new Date();
  const query = FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lte: date },
    endDate: { $gte: date },
  });
  if (session) query.session(session);
  const financialYear = await query;
  if (!financialYear) {
    const err = new Error(
      "Accounting is enabled for this society but no Financial Year covers this payment's date — create one before recording payments.",
    );
    err.status = 409;
    throw err;
  }

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const amount = round2(transaction.amount);
  // Back-compat: callers that don't yet pass the split behave exactly as before
  // (everything against receivable, nothing to advance).
  const dues = appliedToDues == null ? amount : round2(appliedToDues);
  const adv = advance == null ? round2(amount - dues) : round2(advance);

  const event = createAccountingEvent({
    type: EVENT_TYPES.PAYMENT_RECORDED,
    societyId,
    financialYearId: financialYear._id,
    sourceModule: "Payments",
    sourceRef: String(transaction._id),
    actorUserId,
    idempotencyKey: `payment:${transaction._id}`,
    payload: {
      amount,
      appliedToDues: dues,
      advance: adv,
      paymentMode: paymentMode || "Cash",
      date,
      narration: `Payment received via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
    },
  });

  return engineProcess(event, session ? { session } : {});
}
