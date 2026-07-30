import PostingRule from "@/models/PostingRule";
import { DEFAULT_POSTING_RULES } from "@/lib/accounting/postingRules/defaultRules.js";

export class PostingRuleServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "PostingRuleServiceError";
    this.status = status;
  }
}

/**
 * Idempotently seeds the shared default-tier posting rules (societyId: null).
 * Upserts each by its stable systemKey, so re-running never duplicates and
 * always brings the stored default in line with the code. Safe to call at
 * app startup or from an admin action. Returns a summary count.
 */
export async function seedDefaultPostingRules() {
  let upserted = 0;
  for (const rule of DEFAULT_POSTING_RULES) {
    await PostingRule.updateOne(
      { systemKey: rule.systemKey },
      {
        $set: {
          ...rule,
          societyId: null,
          isSystemDefault: true,
          isActive: true,
          isDeleted: false,
        },
      },
      { upsert: true },
    );
    upserted += 1;
  }
  return { seeded: upserted };
}

/**
 * Lists rules visible to a society: its own overrides plus the shared
 * defaults. `onlyOwn` restricts to society-specific rules.
 */
export async function listPostingRules(societyId, { eventType, onlyOwn } = {}) {
  const query = { isDeleted: false };
  if (eventType) query.eventType = eventType;
  query.$or = onlyOwn ? [{ societyId }] : [{ societyId }, { societyId: null }];
  return PostingRule.find(query).sort({ eventType: 1, priority: -1 }).lean();
}

export async function getPostingRuleById(societyId, id) {
  const rule = await PostingRule.findOne({ _id: id, isDeleted: false });
  if (!rule) throw new PostingRuleServiceError(404, "Posting rule not found");
  // A society may read a default-tier rule (societyId null) or its own.
  if (rule.societyId && String(rule.societyId) !== String(societyId)) {
    throw new PostingRuleServiceError(404, "Posting rule not found");
  }
  return rule;
}

/** Creates a per-society override rule. Never lets a caller create a default-tier (null) rule. */
export async function createPostingRule(societyId, data, createdBy) {
  if (!data.eventType || !data.voucherType) {
    throw new PostingRuleServiceError(400, "eventType and voucherType are required");
  }
  if (!data.linesFromPayload && (!Array.isArray(data.lineSpecs) || data.lineSpecs.length === 0)) {
    throw new PostingRuleServiceError(400, "A rule must define lineSpecs unless linesFromPayload is true");
  }
  const rule = await PostingRule.create({
    societyId,
    eventType: data.eventType,
    description: data.description,
    voucherType: data.voucherType,
    conditions: data.conditions || [],
    priority: data.priority ?? 1,
    lineSpecs: data.lineSpecs || [],
    linesFromPayload: !!data.linesFromPayload,
    partialPaymentHandling: data.partialPaymentHandling || null,
    interestHandling: data.interestHandling || null,
    penaltyHandling: data.penaltyHandling || null,
    advancePaymentHandling: data.advancePaymentHandling || null,
    reversalBehavior: data.reversalBehavior || null,
    isSystemDefault: false,
    createdBy,
  });
  return rule;
}

/** Updates a per-society override rule. System-default rules cannot be edited (only shadowed). */
export async function updatePostingRule(societyId, id, patch) {
  const rule = await getPostingRuleById(societyId, id);
  if (rule.isSystemDefault || !rule.societyId) {
    throw new PostingRuleServiceError(
      409,
      "Default-tier rules cannot be edited. Create a society-specific rule with higher priority to override.",
    );
  }
  const patchable = [
    "description",
    "voucherType",
    "conditions",
    "priority",
    "lineSpecs",
    "linesFromPayload",
    "partialPaymentHandling",
    "interestHandling",
    "penaltyHandling",
    "advancePaymentHandling",
    "reversalBehavior",
    "isActive",
  ];
  for (const key of patchable) {
    if (patch[key] !== undefined) rule[key] = patch[key];
  }
  await rule.save();
  return rule;
}

export async function deletePostingRule(societyId, id) {
  const rule = await getPostingRuleById(societyId, id);
  if (rule.isSystemDefault || !rule.societyId) {
    throw new PostingRuleServiceError(409, "Default-tier rules cannot be deleted.");
  }
  rule.isDeleted = true;
  await rule.save();
  return { deleted: true };
}
