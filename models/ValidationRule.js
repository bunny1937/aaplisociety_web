import mongoose from "mongoose";

// Phase 2.16 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.15). Configurable validation rules — same two-tier shape as PostingRule
// (§6.12): a shared default tier (societyId: null) plus optional per-society
// overrides. `rule` is a resolver key into CHECK_REGISTRY
// (lib/accounting/validation/checks.js) — never free-form code stored here.

const SEVERITIES = ["Info", "Warning", "Error"];

const ValidationRuleSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", default: null, index: true },
    rule: { type: String, required: true, index: true }, // CHECK_REGISTRY key
    description: { type: String, trim: true },
    severity: { type: String, enum: SEVERITIES, default: "Warning" },
    // Blocks Trial Balance / Balance Sheet generation (future phases) when true.
    blocking: { type: Boolean, default: false },
    autoFixAvailable: { type: Boolean, default: false },
    autoFixResolverKey: { type: String, default: null },
    navigationTarget: { type: String, trim: true },
    helpText: { type: String, trim: true },
    suggestedResolution: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    isSystemDefault: { type: Boolean, default: false },
    systemKey: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ValidationRuleSchema.index({ societyId: 1, rule: 1, isActive: 1 });
ValidationRuleSchema.index(
  { systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } },
);

ValidationRuleSchema.statics.SEVERITIES = SEVERITIES;

export default mongoose.models.ValidationRule || mongoose.model("ValidationRule", ValidationRuleSchema);
