import mongoose from "mongoose";

// Phase 2.19 of the accounting-system revamp (docs/accounting-system-ARD.md
// §5.1, §8). Answers "what accounting adjustment modified Voucher X, and
// why" — a different concern from the generic AuditLog ("who changed this
// document"), kept deliberately separate (§5.1's decision). Append-only,
// immutable activity record: no isDeleted, no update path — once an
// adjustment is recorded here it stands, same as AuditLog.

const ACTIONS = ["Adjustment", "Reversal", "Correction"];

const JournalAuditTrailSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    action: { type: String, enum: ACTIONS, default: "Adjustment" },
    // The voucher/entry being corrected (may belong to a Locked period —
    // that's the entire point of Auditor Mode).
    originalVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", required: true },
    originalJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    // The new voucher this adjustment posted as (§6.7: corrections always
    // create a new voucher, never mutate the original).
    adjustmentVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", required: true },
    adjustmentJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    reason: { type: String, required: true, trim: true },
    beforeLines: { type: mongoose.Schema.Types.Mixed, default: [] },
    afterLines: { type: mongoose.Schema.Types.Mixed, default: [] },
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adjustedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

JournalAuditTrailSchema.index({ societyId: 1, originalVoucherId: 1 });
JournalAuditTrailSchema.index({ societyId: 1, financialYearId: 1 });

JournalAuditTrailSchema.statics.ACTIONS = ACTIONS;

export default mongoose.models.JournalAuditTrail || mongoose.model("JournalAuditTrail", JournalAuditTrailSchema);
