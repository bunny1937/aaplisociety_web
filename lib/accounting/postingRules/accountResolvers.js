import BillingHead from "@/models/BillingHead";

// Phase 2.7 — resolves a PostingRule line's `accountKey` string to a concrete
// ChartOfAccount ObjectId at posting time. This is the "never hardcode an
// account id in code" guarantee (§6.12): code knows resolver KEYS, the
// per-society account bindings live in data (Society.accountingConfig,
// BillingHead.linkedAccountId, or the event payload).

export class PostingRuleError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "PostingRuleError";
    this.status = status;
    this.code = code;
  }
}

// Maps named config keys to their field on accountingConfig.defaultAccountMappings.
export const NAMED_ACCOUNT_KEYS = Object.freeze({
  maintenanceIncome: "maintenanceIncomeAccountId",
  interestIncome: "interestIncomeAccountId",
  cash: "cashAccountId",
  defaultBank: "defaultBankAccountId",
  memberReceivable: "memberReceivableAccountId",
  roundOff: "roundOffAccountId",
  // Liability side of an over-collection. Required so a member paying more
  // than their outstanding dues credits 'Advance Received From Members'
  // instead of pushing Member Receivable into a negative (contra) balance.
  memberAdvance: "memberAdvanceAccountId",
});

/** Safe dot-path getter: resolvePath({a:{b:2}}, "a.b") === 2. */
export function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * Resolves one accountKey to an account id.
 * @returns {Promise<string>} the resolved ChartOfAccount id
 * @throws {PostingRuleError} if the key can't be resolved (e.g. an unmapped config account)
 */
export async function resolveAccountKey(accountKey, { config, event, societyId, session }) {
  if (!accountKey) {
    throw new PostingRuleError(422, "Posting rule line is missing an accountKey", "BAD_KEY");
  }

  // payload:<dotpath> — account id supplied on the event payload.
  if (accountKey.startsWith("payload:")) {
    const path = accountKey.slice("payload:".length);
    const id = resolvePath(event.payload, path);
    if (!id) {
      throw new PostingRuleError(
        422,
        `Posting rule expected an account id at event payload path "${path}" but found none`,
        "MISSING_PAYLOAD_ACCOUNT",
      );
    }
    return String(id);
  }

  // billingHead:<headId> — the head's linked income account.
  if (accountKey.startsWith("billingHead:")) {
    const headId = accountKey.slice("billingHead:".length);
    const head = await BillingHead.findOne({ _id: headId, societyId, isDeleted: false })
      .select("linkedAccountId headName")
      .session(session)
      .lean();
    if (!head || !head.linkedAccountId) {
      throw new PostingRuleError(
        422,
        `Billing head "${headId}" has no linked Chart of Accounts income account`,
        "UNMAPPED_BILLING_HEAD",
      );
    }
    return String(head.linkedAccountId);
  }

  // Named config key.
  const mappingField = NAMED_ACCOUNT_KEYS[accountKey];
  if (!mappingField) {
    throw new PostingRuleError(422, `Unknown account resolver key "${accountKey}"`, "UNKNOWN_KEY");
  }
  const id = config?.defaultAccountMappings?.[mappingField];
  if (!id) {
    throw new PostingRuleError(
      422,
      `Account mapping "${mappingField}" is not configured for this society — set it in the fiscal configuration before posting`,
      "UNMAPPED_ACCOUNT",
    );
  }
  return String(id);
}

/** Coerces a rule line's amountKey to a rounded, positive-or-zero number. */
export function resolveAmount(payload, amountKey) {
  const raw = amountKey === "amount" ? payload?.amount : resolvePath(payload, amountKey);
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}