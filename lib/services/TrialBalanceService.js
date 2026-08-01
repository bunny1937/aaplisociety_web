import FinancialYear from "@/models/FinancialYear";
import { getLedgerSummary } from "@/lib/services/GeneralLedgerService";

// Phase 2.15 of the accounting-system revamp (docs/accounting-system-ARD.md
// §8). The Trial Balance is a pure aggregation over Phase 2.9's General
// Ledger summary — no new source-of-truth data, consistent with "reports
// never contain business logic" (§1). Its job is the debit=credit gate: it
// is what a Financial Year "balances" means, and what Phase 2.17's Closing
// Wizard / Phase 2.18's Financial Statements must check before proceeding
// (§9.1 deliverable "validation rules" for this phase). assertTrialBalanced
// is the reusable blocking primitive those later phases call — this phase
// doesn't wire it into anything yet since neither exists.

const EPSILON = 0.005;

export class TrialBalanceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TrialBalanceServiceError";
    this.status = status;
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Trial Balance for one Financial Year: every account with posted activity,
 * shown on its natural Dr or Cr side, plus the totals that must match for the
 * ledger to be considered balanced.
 */
export async function getTrialBalance(societyId, financialYearId) {
  if (!financialYearId) throw new TrialBalanceServiceError(400, "financialYearId is required");
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).lean();
  if (!fy) throw new TrialBalanceServiceError(404, "Financial Year not found");

  const summary = await getLedgerSummary(societyId, { financialYearId });

  const rows = summary.map((r) => ({
    accountId: r.accountId,
    code: r.code,
    name: r.name,
    type: r.type,
    debit: r.side === "Dr" ? r.balance : 0,
    credit: r.side === "Cr" ? r.balance : 0,
  }));

  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
  const difference = round2(totalDebit - totalCredit);

  return {
    financialYearId: String(fy._id),
    financialYearLabel: fy.label,
    rows,
    totalDebit,
    totalCredit,
    difference,
    isBalanced: Math.abs(difference) < EPSILON,
  };
}

/** Blocking primitive: throws unless the Financial Year's Trial Balance is balanced. */
export async function assertTrialBalanced(societyId, financialYearId) {
  const tb = await getTrialBalance(societyId, financialYearId);
  if (!tb.isBalanced) {
    throw new TrialBalanceServiceError(
      409,
      `Trial Balance for "${tb.financialYearLabel}" does not balance: debit ${tb.totalDebit} vs credit ${tb.totalCredit} (difference ${tb.difference})`,
    );
  }
  return tb;
}

/** CSV export, same formula-injection guard as the General Ledger export. */
export async function exportTrialBalanceCsv(societyId, financialYearId) {
  const tb = await getTrialBalance(societyId, financialYearId);
  const esc = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [];
  rows.push([`Trial Balance: ${tb.financialYearLabel}`].map(esc).join(","));
  rows.push(["Code", "Account", "Type", "Debit", "Credit"].map(esc).join(","));
  for (const r of tb.rows) {
    rows.push([r.code, r.name, r.type, r.debit || "", r.credit || ""].map(esc).join(","));
  }
  rows.push(["", "", "TOTAL", tb.totalDebit, tb.totalCredit].map(esc).join(","));
  rows.push(["", "", tb.isBalanced ? "BALANCED" : `OUT OF BALANCE (${tb.difference})`, "", ""].map(esc).join(","));
  return rows.join("\n");
}
