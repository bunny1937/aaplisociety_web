import mongoose from "mongoose";

// Phase 2.18 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.3, §7). Lightweight reference/tagging collection consumed by the
// Financial Statements module — account *grouping* metadata only, no
// business logic (§1 "reports must never contain business logic"). Two-tier
// shape (default + per-society override) since exact statutory schedule
// naming varies by state/registrar, same convention as PostingRule/
// ValidationRule.

const CATEGORIES = ["Asset", "Liability", "Equity", "Income", "Expense"];

const ScheduleSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", default: null, index: true },
    code: { type: String, required: true, trim: true }, // e.g. "A", "B", "C"
    label: { type: String, required: true, trim: true }, // e.g. "Share Capital"
    category: { type: String, enum: CATEGORIES, required: true },
    displayOrder: { type: Number, default: 0 },
    isSystemDefault: { type: Boolean, default: false },
    systemKey: { type: String, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ScheduleSchema.index({ societyId: 1, code: 1 }, { unique: true });
ScheduleSchema.index(
  { systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } },
);

ScheduleSchema.statics.CATEGORIES = CATEGORIES;

export default mongoose.models.Schedule || mongoose.model("Schedule", ScheduleSchema);
