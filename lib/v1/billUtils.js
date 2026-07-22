// Bill/receipt/transaction presentation + id helpers, ported from the mobile
// backend bills/ledger/receipts controllers.
import crypto from "node:crypto";
import { periodLabelFrom } from "./periodLabel";

const num = (v) => parseFloat((Number(v) || 0).toFixed(2));

// Enrich a raw bill doc with member + period context for the app UI.
//
// Ledger V2 §13: in addition to the backward-compatible top-level fields, this
// now exposes a canonical presentation contract: a `member` block and a
// `ledger` block carrying the nine source-of-truth figures. balanceAmount is
// ALWAYS derived as closingPrincipal + closingInterest, never trusted blindly
// from storage.
export function normalizeBill(b, member) {
  const plain = typeof b.toObject === "function" ? b.toObject() : b;

  const openingPrincipal = num(plain.openingPrincipal);
  const openingInterest = num(plain.openingInterest);
  const currentCharges = num(plain.currentCharges);
  const currentInterest = num(plain.currentInterest);
  // Closing values fall back to legacy fields for pre-migration bills.
  const closingPrincipal = num(plain.closingPrincipal ?? plain.principalBalance);
  const closingInterest = num(plain.closingInterest ?? plain.interestBalance);
  const totalBillDue = num(plain.totalBillDue ?? plain.totalAmount);
  const amountPaid = num(plain.amountPaid);
  // §5 identity: balanceAmount === closingPrincipal + closingInterest.
  const balanceAmount = num(closingPrincipal + closingInterest);

  const memberBlock = {
    flatNo: member?.flatNo ?? null,
    wing: member?.wing ?? null,
    ownerName: member?.ownerName ?? null,
    carpetAreaSqft: member?.carpetAreaSqft ?? null,
  };

  return {
    ...plain,
    _id: String(plain._id),
    periodLabel: periodLabelFrom(plain),
    // Backward-compatible top-level fields (existing consumers rely on these).
    ownerName: memberBlock.ownerName,
    flatNo: memberBlock.flatNo,
    wing: memberBlock.wing,
    carpetAreaSqft: memberBlock.carpetAreaSqft,
    billHtml: plain.billHtml ?? null,
    // ── Ledger V2 §13 canonical presentation contract ──
    member: memberBlock,
    ledger: {
      billPeriodId: plain.billPeriodId ?? null,
      status: plain.status ?? null,
      dueDate: plain.dueDate ?? null,
      openingPrincipal,
      openingInterest,
      currentCharges,
      currentInterest,
      closingPrincipal,
      closingInterest,
      totalBillDue,
      amountPaid,
      balanceAmount,
      interestRateApplied: num(plain.interestRateApplied),
      schemaVersion: plain.schemaVersion ?? null,
      calculationVersion: plain.calculationVersion ?? null,
      rendererVersion: plain.rendererVersion ?? null,
      engineVersion: plain.engineVersion ?? null,
    },
  };
}

export function newReceiptNo() {
  return `RCP-${Date.now()}-${crypto.randomInt(1000, 9999)}`;
}

export function newTransactionId() {
  return `TXN${crypto.randomInt(100000000, 999999999)}`;
}

// Resolve the outstanding balances used by the allocation engine, tolerating
// both the web bill shape (balanceAmount / principalBalance / interestBalance)
// and the lean mobile bill shape (amount / amountPaid).
export function billBalances(bill) {
  const totalAmount = bill.totalAmount ?? bill.amount ?? 0;
  const amountPaid = bill.amountPaid ?? 0;
  const balanceAmount = bill.balanceAmount ?? Math.max(0, totalAmount - amountPaid);
  const interestBalance = bill.interestBalance ?? bill.interest ?? 0;
  const principalBalance =
    bill.principalBalance ?? Math.max(0, balanceAmount - interestBalance);
  return { totalAmount, amountPaid, balanceAmount, interestBalance, principalBalance };
}
