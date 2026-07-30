import Society from "@/models/Society";

export class FiscalConfigServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FiscalConfigServiceError";
    this.status = status;
  }
}

// Mirrors models/Society.js's accountingConfig schema defaults. Needed
// because Mongoose only applies schema defaults when hydrating a full
// document — .lean() reads (used throughout the codebase for read-only
// paths) return undefined for any sub-field an older Society document
// predates. This function is the one place that guarantees callers always
// see a complete, defaulted config regardless of how the document was read.
const DEFAULTS = {
  enabled: false,
  financialYearDefaults: { startMonth: 3, lockAfterDays: 0 },
  voucherPrefixes: {
    Receipt: "RV",
    Payment: "PV",
    Journal: "JV",
    Contra: "CV",
    DebitNote: "DN",
    CreditNote: "CN",
  },
  voucherNumberPadding: 5,
  defaultAccountMappings: {
    maintenanceIncomeAccountId: null,
    interestIncomeAccountId: null,
    cashAccountId: null,
    defaultBankAccountId: null,
    memberReceivableAccountId: null,
    roundOffAccountId: null,
  },
  depreciationPolicy: { method: "StraightLine", roundingRule: "nearest" },
  interestPolicy: { postingAccountId: null },
  taxConfig: { gstEnabled: false, tdsEnabled: false },
  roundingPolicy: { method: "nearest", precision: 2 },
  currency: { code: "INR", symbol: "₹" },
  scheduleConfig: { format: "default", customScheduleMap: null },
  auditorPreferences: { defaultReadOnly: true, requireRemarksOnAdjustment: true },
  financialClosingRules: {
    requireTrialBalanceMatch: true,
    requireAllDepreciationPosted: true,
    requireReconciliationComplete: false,
  },
  documentLockingRules: {
    lockVouchersAfterApproval: true,
    allowBackdatedEntriesInDraftFY: true,
  },
};

function deepMerge(defaults, stored) {
  if (!stored || typeof stored !== "object") return defaults;
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const defaultVal = defaults[key];
    const storedVal = stored[key];
    if (storedVal === undefined || storedVal === null) continue;
    if (
      defaultVal &&
      typeof defaultVal === "object" &&
      !Array.isArray(defaultVal) &&
      typeof storedVal === "object"
    ) {
      out[key] = deepMerge(defaultVal, storedVal);
    } else {
      out[key] = storedVal;
    }
  }
  return out;
}

/** Returns a fully-defaulted accountingConfig for a society, regardless of how much (if any) it has configured. */
export async function getFiscalConfig(societyId, session = null) {
  const query = Society.findById(societyId).select("accountingConfig");
  if (session) query.session(session);
  const society = await query.lean();
  if (!society) {
    throw new FiscalConfigServiceError(404, "Society not found");
  }
  return deepMerge(DEFAULTS, society.accountingConfig);
}

/**
 * Merge-updates a society's accountingConfig. Only top-level keys present in
 * `patch` are touched; nested objects are shallow-merged one level to avoid
 * accidentally clobbering sibling settings the caller didn't intend to change.
 */
export async function updateFiscalConfig(societyId, patch) {
  const society = await Society.findById(societyId);
  if (!society) {
    throw new FiscalConfigServiceError(404, "Society not found");
  }
  const current = society.accountingConfig
    ? society.accountingConfig.toObject
      ? society.accountingConfig.toObject()
      : society.accountingConfig
    : {};
  const merged = deepMerge(deepMerge(DEFAULTS, current), patch);
  society.accountingConfig = merged;
  society.markModified("accountingConfig");
  await society.save();
  return merged;
}
