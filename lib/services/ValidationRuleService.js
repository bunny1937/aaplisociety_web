import ValidationRule from "@/models/ValidationRule";
import { DEFAULT_VALIDATION_RULES } from "@/lib/accounting/validation/defaultValidationRules.js";
import { CHECK_REGISTRY } from "@/lib/accounting/validation/checks.js";

export class ValidationRuleServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ValidationRuleServiceError";
    this.status = status;
  }
}

/** Idempotently seeds the shared default-tier validation rules (societyId: null). Upserts by systemKey. */
export async function seedDefaultValidationRules() {
  let upserted = 0;
  for (const rule of DEFAULT_VALIDATION_RULES) {
    await ValidationRule.updateOne(
      { systemKey: rule.systemKey },
      { $set: { ...rule, societyId: null, isSystemDefault: true, isActive: true, isDeleted: false } },
      { upsert: true },
    );
    upserted += 1;
  }
  return { seeded: upserted };
}

export async function listValidationRules(societyId, { onlyOwn } = {}) {
  const query = { isDeleted: false };
  query.$or = onlyOwn ? [{ societyId }] : [{ societyId }, { societyId: null }];
  return ValidationRule.find(query).sort({ severity: -1, rule: 1 }).lean();
}

/** Per-society override — the `rule` key must map to an already-registered check function. */
export async function createValidationRule(societyId, data, createdBy) {
  if (!data.rule) throw new ValidationRuleServiceError(400, "rule is required");
  if (!CHECK_REGISTRY[data.rule]) {
    throw new ValidationRuleServiceError(422, `Unknown validation check "${data.rule}"`);
  }
  return ValidationRule.create({
    societyId,
    rule: data.rule,
    description: data.description,
    severity: data.severity || "Warning",
    blocking: !!data.blocking,
    autoFixAvailable: !!data.autoFixAvailable,
    autoFixResolverKey: data.autoFixResolverKey || null,
    navigationTarget: data.navigationTarget,
    helpText: data.helpText,
    suggestedResolution: data.suggestedResolution,
    isSystemDefault: false,
    createdBy,
  });
}

export async function updateValidationRule(societyId, id, patch) {
  const rule = await ValidationRule.findOne({ _id: id, isDeleted: false });
  if (!rule) throw new ValidationRuleServiceError(404, "Validation rule not found");
  if (rule.isSystemDefault || !rule.societyId) {
    throw new ValidationRuleServiceError(409, "Default-tier rules cannot be edited. Create a society-specific rule instead.");
  }
  if (String(rule.societyId) !== String(societyId)) {
    throw new ValidationRuleServiceError(404, "Validation rule not found");
  }
  const patchable = ["description", "severity", "blocking", "autoFixAvailable", "autoFixResolverKey", "navigationTarget", "helpText", "suggestedResolution", "isActive"];
  for (const key of patchable) {
    if (patch[key] !== undefined) rule[key] = patch[key];
  }
  await rule.save();
  return rule;
}

export async function deleteValidationRule(societyId, id) {
  const rule = await ValidationRule.findOne({ _id: id, isDeleted: false });
  if (!rule) throw new ValidationRuleServiceError(404, "Validation rule not found");
  if (rule.isSystemDefault || !rule.societyId) {
    throw new ValidationRuleServiceError(409, "Default-tier rules cannot be deleted.");
  }
  if (String(rule.societyId) !== String(societyId)) {
    throw new ValidationRuleServiceError(404, "Validation rule not found");
  }
  rule.isDeleted = true;
  await rule.save();
  return { deleted: true };
}

/**
 * Runs every active rule visible to a society (its own overrides + shared
 * defaults, with a society-specific rule shadowing the default for the same
 * `rule` key) against current ledger/voucher/FY state. Returns one result
 * per rule plus a summary. This is the engine — it embeds no per-check logic
 * itself, only reads results from CHECK_REGISTRY (§6.15's "config drives
 * behavior, engine stays generic").
 */
export async function runValidations(societyId, { financialYearId } = {}) {
  const rules = await ValidationRule.find({
    isActive: true,
    isDeleted: false,
    $or: [{ societyId }, { societyId: null }],
  }).lean();

  const ownRuleKeys = new Set(rules.filter((r) => r.societyId).map((r) => r.rule));
  const effective = rules.filter((r) => r.societyId || !ownRuleKeys.has(r.rule));

  const results = [];
  for (const rule of effective) {
    const check = CHECK_REGISTRY[rule.rule];
    if (!check) {
      results.push({
        ruleId: String(rule._id),
        rule: rule.rule,
        description: rule.description,
        severity: rule.severity,
        blocking: rule.blocking,
        passed: false,
        message: `Validation rule references unknown check "${rule.rule}"`,
        count: 0,
        items: [],
        navigationTarget: rule.navigationTarget,
        helpText: rule.helpText,
        suggestedResolution: rule.suggestedResolution,
        autoFixAvailable: false,
      });
      continue;
    }
    const outcome = await check(societyId, { financialYearId });
    results.push({
      ruleId: String(rule._id),
      rule: rule.rule,
      description: rule.description,
      severity: rule.severity,
      blocking: rule.blocking,
      passed: outcome.passed,
      message: outcome.message,
      count: outcome.count,
      items: outcome.items,
      navigationTarget: rule.navigationTarget,
      helpText: rule.helpText,
      suggestedResolution: rule.suggestedResolution,
      autoFixAvailable: rule.autoFixAvailable,
    });
  }

  const failures = results.filter((r) => !r.passed);
  const blockingFailures = failures.filter((r) => r.blocking);

  return {
    financialYearId: financialYearId ? String(financialYearId) : null,
    results,
    failureCount: failures.length,
    blockingFailureCount: blockingFailures.length,
    hasBlockingFailures: blockingFailures.length > 0,
  };
}
