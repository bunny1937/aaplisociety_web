import PostingRule from "@/models/PostingRule";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import {
  PostingRuleError,
  resolveAccountKey,
  resolveAmount,
  resolvePath,
} from "@/lib/accounting/postingRules/accountResolvers.js";

// Phase 2.7 — the function registered as the Accounting Engine's
// postingResolver seam. Given an AccountingEvent, it selects the matching
// PostingRule and returns fully-resolved { voucherType, narration, lines }.
// The engine then validates balance + account validity and posts. This module
// contains the rule-SELECTION and account-RESOLUTION logic; it deliberately
// has no per-event-type branching — every event is handled the same way,
// driven by data.

function evalCondition(payload, cond) {
  const actual = cond.field === "amount" ? payload?.amount : resolvePath(payload, cond.field);
  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "ne":
      return actual !== cond.value;
    case "gt":
      return Number(actual) > Number(cond.value);
    case "gte":
      return Number(actual) >= Number(cond.value);
    case "lt":
      return Number(actual) < Number(cond.value);
    case "lte":
      return Number(actual) <= Number(cond.value);
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case "exists":
      return (actual !== undefined && actual !== null) === Boolean(cond.value);
    default:
      return false;
  }
}

function ruleMatches(rule, payload) {
  return (rule.conditions || []).every((c) => evalCondition(payload, c));
}

/**
 * Selects the single winning rule for an event. Society-specific rules shadow
 * default-tier rules for the same event type; within the chosen tier the
 * highest priority wins, and a tie at the top is a hard error (§9.2).
 */
function selectRule(rules, event) {
  const matching = rules.filter((r) => ruleMatches(r, event.payload));
  if (matching.length === 0) {
    throw new PostingRuleError(
      422,
      `No posting rule matches event "${event.type}" for this society`,
      "NO_RULE",
    );
  }
  const societySpecific = matching.filter((r) => r.societyId);
  const tier = societySpecific.length > 0 ? societySpecific : matching;
  tier.sort((a, b) => b.priority - a.priority);
  if (tier.length > 1 && tier[0].priority === tier[1].priority) {
    throw new PostingRuleError(
      409,
      `Ambiguous posting rules for event "${event.type}": two rules share priority ${tier[0].priority}. Resolve by adjusting priorities.`,
      "AMBIGUOUS_RULE",
    );
  }
  return tier[0];
}

async function buildLines(rule, event, ctx) {
  const specs = rule.linesFromPayload
    ? // User/wizard-supplied lines: each { accountKey|accountId, side, amount }
      (event.payload?.lines || []).map((l) => ({
        accountKey: l.accountKey || (l.accountId ? `payload-literal` : undefined),
        _literalAccountId: l.accountId || null,
        side: l.side,
        _literalAmount: Number(l.amount),
      }))
    : rule.lineSpecs;

  if (!specs || specs.length === 0) {
    throw new PostingRuleError(
      422,
      `Posting rule for "${event.type}" produced no lines`,
      "NO_LINES",
    );
  }

  const lines = [];
  for (const spec of specs) {
    // Amount
    const amount = rule.linesFromPayload
      ? Math.round((spec._literalAmount || 0) * 100) / 100
      : resolveAmount(event.payload, spec.amountKey);
    if (!(amount > 0)) {
      if (!rule.linesFromPayload && spec.optional) continue; // skip zero optional lines
      throw new PostingRuleError(
        422,
        `Posting rule line resolved to a non-positive amount (${amount}) and is not marked optional`,
        "BAD_AMOUNT",
      );
    }
    // Account
    const accountId = spec._literalAccountId
      ? String(spec._literalAccountId)
      : await resolveAccountKey(spec.accountKey, ctx);

    lines.push({
      accountId,
      side: spec.side,
      amount,
      partyType: event.payload?.partyType,
      partyRef: event.payload?.partyRef,
      narration: spec.narration,
    });
  }
  return lines;
}

/**
 * The resolver registered into AccountingEngine. Matches the engine's
 * expected signature: (event, { session, financialYear }) => { voucherType, narration, lines }.
 */
export async function resolvePosting(event, { session } = {}) {
  const rules = await PostingRule.find({
    eventType: event.type,
    isActive: true,
    isDeleted: false,
    $or: [{ societyId: event.societyId }, { societyId: null }],
  })
    .session(session)
    .lean();

  const rule = selectRule(rules, event);
  const config = await getFiscalConfig(event.societyId, session);
  const lines = await buildLines(rule, event, {
    config,
    event,
    societyId: event.societyId,
    session,
  });

  return {
    voucherType: rule.voucherType,
    narration: event.payload?.narration,
    lines,
  };
}
