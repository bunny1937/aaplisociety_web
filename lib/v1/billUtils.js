// Bill/receipt/transaction presentation + id helpers, ported from the mobile
// backend bills/ledger/receipts controllers.
import crypto from "node:crypto";
import { periodLabelFrom } from "./periodLabel";

// Enrich a raw bill doc with member + period context for the app UI.
export function normalizeBill(b, member) {
  const plain = typeof b.toObject === "function" ? b.toObject() : b;
  return {
    ...plain,
    _id: String(plain._id),
    periodLabel: periodLabelFrom(plain),
    ownerName: member?.ownerName ?? null,
    flatNo: member?.flatNo ?? null,
    wing: member?.wing ?? null,
    carpetAreaSqft: member?.carpetAreaSqft ?? null,
    billHtml: plain.billHtml ?? null,
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
