import mongoose from "mongoose";

// Phase 2.7 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.12). Configurable posting rules — the Accounting Engine embeds NO
// per-event-type accounting logic; it asks the PostingRuleResolver for the
// debit/credit lines, and the resolver reads these documents.
//
// Two tiers: a shared default tier (societyId: null) that every society
// inherits, and optional per-society overrides. A society-specific rule for
// an event type shadows the default rules for that same event type.
//
// Account references are NEVER hardcoded ObjectIds baked into code. Each line
// carries an `accountKey` resolver string, resolved to a real account at
// posting time (see lib/accounting/postingRules/accountResolvers.js):
//   - a named config key ("memberReceivable", "maintenanceIncome", "cash",
//     "defaultBank", "interestIncome", "roundOff") → Society.accountingConfig
//   - "billingHead:<headId>"  → BillingHead.linkedAccountId
//   - "payload:<dotpath>"     → an account id supplied on the event payload
//     (manual vouchers, opening-balance wizard)

const CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "exists"];

const ConditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true }, // dot-path into event.payload
    op: { type: String, enum: CONDITION_OPS, default: "eq" },
    value: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const LineSpecSchema = new mongoose.Schema(
  {
    accountKey: { type: String, required: true },
    side: { type: String, enum: ["Debit", "Credit"], required: true },
    // dot-path into event.payload resolving to a number, or the literal
    // "amount" for payload.amount.
    amountKey: { type: String, required: true },
    // When true, a line whose resolved amount is 0/absent is silently
    // skipped (e.g. the interest line of a bill with no interest) rather
    // than emitted as a zero line. The engine still enforces overall balance.
    optional: { type: Boolean, default: false },
    narration: { type: String, trim: true },
  },
  { _id: false },
);

const PostingRuleSchema = new mongoose.Schema(
  {
    // null = shared default tier inherited by every society.
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      default: null,
      index: true,
    },
    eventType: { type: String, required: true, index: true },
    description: { type: String, trim: true },
    voucherType: {
      type: String,
      enum: ["Receipt", "Payment", "Journal", "Contra", "DebitNote", "CreditNote"],
      required: true,
    },
    conditions: { type: [ConditionSchema], default: [] },
    // Higher priority wins when several rules match one event. Two matching
    // rules with equal priority in the same tier is treated as a hard error
    // by the resolver (§9.2 "no ambiguity"), never a silent pick.
    priority: { type: Number, default: 1 },
    // Rule-defined lines (automated events like BillGenerated/PaymentRecorded).
    lineSpecs: { type: [LineSpecSchema], default: [] },
    // When true, the resolver ignores lineSpecs and reads the lines straight
    // off event.payload.lines (each { accountKey|accountId, side, amount }).
    // Used by manual journal vouchers and the Opening Balance Wizard, where
    // the user/wizard chooses the accounts, not a fixed rule.
    linesFromPayload: { type: Boolean, default: false },
    // Reserved structured-config blocks (§6.12). Not all are consumed yet;
    // they exist so future handling (penalty splits, advance treatment,
    // reversal behavior) is config, not code.
    partialPaymentHandling: { type: mongoose.Schema.Types.Mixed, default: null },
    interestHandling: { type: mongoose.Schema.Types.Mixed, default: null },
    penaltyHandling: { type: mongoose.Schema.Types.Mixed, default: null },
    advancePaymentHandling: { type: mongoose.Schema.Types.Mixed, default: null },
    reversalBehavior: { type: mongoose.Schema.Types.Mixed, default: null },
    isActive: { type: Boolean, default: true },
    isSystemDefault: { type: Boolean, default: false }, // seeded default-tier rule
    // Stable identifier for seeded default-tier rules, so re-running the
    // seeder is idempotent (upsert by systemKey) instead of duplicating.
    // Null/absent for user-created rules.
    systemKey: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

PostingRuleSchema.index({ societyId: 1, eventType: 1, isActive: 1 });
PostingRuleSchema.index(
  { systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } },
);

PostingRuleSchema.statics.CONDITION_OPS = CONDITION_OPS;

export default mongoose.models.PostingRule ||
  mongoose.model("PostingRule", PostingRuleSchema);
