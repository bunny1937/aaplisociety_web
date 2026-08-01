import ChartOfAccount from "@/models/ChartOfAccount";
import Voucher from "@/models/Voucher";
import Asset from "@/models/Asset";
import Liability from "@/models/Liability";
import BankAccount from "@/models/BankAccount";
import BankStatementLine from "@/models/BankStatementLine";
import { getTrialBalance } from "@/lib/services/TrialBalanceService";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";

// Phase 2.16 (docs/accounting-system-ARD.md §6.15). Each key here is a
// registered check function — the ONLY thing a ValidationRule document can
// point at (via its `rule` field), never free-form code stored in the DB.
// Every check has the same shape: (societyId, { financialYearId }) =>
// { passed, count, items, message }. Adding a new check means adding a
// function here + a rule row (seeded or per-society); the engine
// (ValidationRuleService.runValidations) stays generic either way — same
// "config drives behavior, engine stays generic" pattern as the Posting Rule
// Registry (§6.12).

export const CHECK_REGISTRY = {
  async trialBalanceBalanced(societyId, { financialYearId }) {
    if (!financialYearId) return { passed: true, count: 0, items: [], message: "No Financial Year in scope" };
    const tb = await getTrialBalance(societyId, financialYearId);
    return {
      passed: tb.isBalanced,
      count: tb.isBalanced ? 0 : 1,
      items: tb.isBalanced ? [] : [{ totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, difference: tb.difference }],
      message: tb.isBalanced
        ? "Trial Balance is balanced"
        : `Trial Balance out of balance by ${tb.difference} (debit ${tb.totalDebit} vs credit ${tb.totalCredit})`,
    };
  },

  async accountsMissingScheduleCode(societyId) {
    const accounts = await ChartOfAccount.find({ societyId, isActive: true, isDeleted: false, scheduleCode: null })
      .select("code name")
      .lean();
    return {
      passed: accounts.length === 0,
      count: accounts.length,
      items: accounts.map((a) => ({ accountId: String(a._id), code: a.code, name: a.name })),
      message: accounts.length === 0 ? "Every active account has a scheduleCode" : `${accounts.length} active account(s) have no scheduleCode`,
    };
  },

  async unmappedDefaultAccountMappings(societyId) {
    const config = await getFiscalConfig(societyId);
    if (!config.enabled) {
      return { passed: true, count: 0, items: [], message: "Accounting is not enabled for this society" };
    }
    const missing = Object.entries(config.defaultAccountMappings)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return {
      passed: missing.length === 0,
      count: missing.length,
      items: missing,
      message: missing.length === 0 ? "All default account mappings are configured" : `Unmapped: ${missing.join(", ")}`,
    };
  },

  async draftVouchersPending(societyId, { financialYearId }) {
    const query = { societyId, status: "Draft", isDeleted: false };
    if (financialYearId) query.financialYearId = financialYearId;
    const count = await Voucher.countDocuments(query);
    return {
      passed: count === 0,
      count,
      items: [],
      message: count === 0 ? "No Draft vouchers pending" : `${count} voucher(s) still in Draft`,
    };
  },

  async assetsMissingDepreciationThisYear(societyId, { financialYearId }) {
    if (!financialYearId) return { passed: true, count: 0, items: [], message: "No Financial Year in scope" };
    const assets = await Asset.find({ societyId, status: "Active", isDeleted: false }).select("name assetCode depreciationRuns").lean();
    const missing = assets.filter((a) => !a.depreciationRuns.some((r) => String(r.financialYearId) === String(financialYearId)));
    return {
      passed: missing.length === 0,
      count: missing.length,
      items: missing.map((a) => ({ assetId: String(a._id), name: a.name, assetCode: a.assetCode })),
      message: missing.length === 0 ? "Every active asset has depreciation posted for this year" : `${missing.length} active asset(s) have no depreciation run this year`,
    };
  },

  async bankStatementsUnmatched(societyId) {
    const bankAccounts = await BankAccount.find({ societyId, isDeleted: false }).select("_id bankName").lean();
    const bankAccountIds = bankAccounts.map((b) => b._id);
    const unmatched = await BankStatementLine.find({
      societyId,
      bankAccountId: { $in: bankAccountIds },
      isDeleted: false,
      matchStatus: { $ne: "Matched" },
    })
      .select("bankAccountId date amount type")
      .lean();
    return {
      passed: unmatched.length === 0,
      count: unmatched.length,
      items: [],
      message: unmatched.length === 0 ? "All bank statement lines are matched" : `${unmatched.length} bank statement line(s) are unmatched`,
    };
  },

  async liabilitiesOverdue(societyId) {
    const overdue = await Liability.find({
      societyId,
      status: "Open",
      isDeleted: false,
      dueDate: { $ne: null, $lt: new Date() },
    })
      .select("name liabilityCode dueDate outstandingAmount")
      .lean();
    return {
      passed: overdue.length === 0,
      count: overdue.length,
      items: overdue.map((l) => ({ liabilityId: String(l._id), name: l.name, liabilityCode: l.liabilityCode, dueDate: l.dueDate, outstandingAmount: l.outstandingAmount })),
      message: overdue.length === 0 ? "No overdue liabilities" : `${overdue.length} liability/liabilities are overdue`,
    };
  },
};

export const CHECK_KEYS = Object.freeze(Object.keys(CHECK_REGISTRY));
