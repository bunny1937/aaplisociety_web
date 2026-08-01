import FinancialYear from "@/models/FinancialYear";
import { getOpeningStatus } from "@/lib/services/OpeningBalanceService";
import { getTrialBalance } from "@/lib/services/TrialBalanceService";
import { runValidations } from "@/lib/services/ValidationRuleService";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { transitionFinancialYear } from "@/lib/services/FinancialYearService";

// Phase 2.17 of the accounting-system revamp (docs/accounting-system-ARD.md
// §8). The Closing Wizard adds no new ledger primitives — it's a checklist
// aggregator over everything Phases 2.9–2.16 already built, plus a guarded
// wrapper around FinancialYearService.transitionFinancialYear() that blocks
// the final Approved -> Locked step when the society's own
// accountingConfig.financialClosingRules say it should.

export class FinancialClosingServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FinancialClosingServiceError";
    this.status = status;
  }
}

/**
 * Full closing checklist for one Financial Year: opening balances, pending
 * vouchers, Trial Balance, and every registered validation check (which
 * already covers pending depreciation, unmatched bank lines, and overdue
 * liabilities — §6.15). Nothing here duplicates a check that Phase 2.16
 * already owns; this phase only decides which of those checks gate Locking.
 */
export async function getClosingChecklist(societyId, financialYearId) {
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).lean();
  if (!fy) throw new FinancialClosingServiceError(404, "Financial Year not found");

  const [openingStatus, trialBalance, validation, config] = await Promise.all([
    getOpeningStatus(societyId, financialYearId),
    getTrialBalance(societyId, financialYearId),
    runValidations(societyId, { financialYearId }),
    getFiscalConfig(societyId),
  ]);

  const rules = config.financialClosingRules;
  const items = [
    {
      key: "openingBalances",
      label: "Opening balances confirmed",
      passed: openingStatus.openingBalancesConfirmed,
      blocking: true,
      detail: openingStatus,
    },
    {
      key: "trialBalance",
      label: "Trial Balance is balanced",
      passed: trialBalance.isBalanced,
      blocking: !!rules.requireTrialBalanceMatch,
      detail: { totalDebit: trialBalance.totalDebit, totalCredit: trialBalance.totalCredit, difference: trialBalance.difference },
    },
  ];

  for (const result of validation.results) {
    // requireAllDepreciationPosted / requireReconciliationComplete gate the
    // two validation checks they name; every other validation result is
    // shown for visibility but only blocks Locking if the rule itself is
    // marked blocking (an admin's own per-society override, e.g. a custom
    // rule they explicitly want enforced at closing).
    let blocking = result.blocking;
    if (result.rule === "assetsMissingDepreciationThisYear") blocking = !!rules.requireAllDepreciationPosted;
    if (result.rule === "bankStatementsUnmatched") blocking = !!rules.requireReconciliationComplete;
    items.push({
      key: result.rule,
      label: result.description || result.rule,
      passed: result.passed,
      blocking,
      detail: { message: result.message, count: result.count, severity: result.severity },
    });
  }

  const blockingFailures = items.filter((i) => i.blocking && !i.passed);

  return {
    financialYearId: String(fy._id),
    financialYearLabel: fy.label,
    status: fy.status,
    nextStatus: FinancialYear.FORWARD_TRANSITIONS[fy.status],
    items,
    readyToClose: blockingFailures.length === 0,
    blockingFailures: blockingFailures.map((i) => ({ key: i.key, label: i.label })),
  };
}

/**
 * Advances the Financial Year one step. When the step is Approved -> Locked,
 * re-checks the closing checklist and refuses if any blocking item still
 * fails — FinancialYearService itself only guards openingBalancesConfirmed;
 * this is where the rest of §9.2's "partial postings are never acceptable"
 * spirit extends to "don't lock an incomplete period".
 */
export async function advanceFinancialYear(societyId, financialYearId, { byUserId, byRole, note }) {
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).lean();
  if (!fy) throw new FinancialClosingServiceError(404, "Financial Year not found");

  const next = FinancialYear.FORWARD_TRANSITIONS[fy.status];
  if (next === "Locked") {
    const checklist = await getClosingChecklist(societyId, financialYearId);
    if (!checklist.readyToClose) {
      throw new FinancialClosingServiceError(
        409,
        `Cannot lock "${fy.label}" — outstanding blocking items: ${checklist.blockingFailures.map((b) => b.label).join(", ")}`,
      );
    }
  }

  return transitionFinancialYear({ societyId, id: financialYearId, byUserId, byRole, note });
}
