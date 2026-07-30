import mongoose from "mongoose";

// Phase 2.2 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.6, §8). Foundational model everything downstream (Chart of Accounts
// posting, Trial Balance, Financial Closing Wizard) hangs its "is this
// period postable / locked" check off of.
//
// 5-state workflow: Draft -> Reviewed -> Auditor Review -> Approved -> Locked.
// Forward-only via transitionState(); reopening a Locked year is a separate,
// SuperAdmin-only exception path (reopen()), matching the original spec's
// "Year reopening" exception-handling requirement.
const STATES = ["Draft", "Reviewed", "Auditor Review", "Approved", "Locked"];
const FORWARD_TRANSITIONS = {
  Draft: "Reviewed",
  Reviewed: "Auditor Review",
  "Auditor Review": "Approved",
  Approved: "Locked",
  Locked: null,
};

const TransitionSchema = new mongoose.Schema(
  {
    fromStatus: { type: String, enum: STATES, required: true },
    toStatus: { type: String, enum: STATES, required: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    byRole: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true },
    isReopen: { type: Boolean, default: false },
  },
  { _id: false },
);

const FinancialYearSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // e.g. "2025-2026" — display label, not parsed for logic.
    label: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: STATES,
      default: "Draft",
      index: true,
    },
    openingBalancesConfirmed: { type: Boolean, default: false },
    transitions: { type: [TransitionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// A society can only have one FinancialYear covering a given date range —
// prevents accidental duplicate/overlapping periods at the DB level for the
// exact-match case; true overlap checking (partial ranges) is done in
// FinancialYearService before insert, since Mongo can't express range
// overlap in a unique index.
FinancialYearSchema.index(
  { societyId: 1, startDate: 1, endDate: 1 },
  { unique: true },
);

FinancialYearSchema.statics.STATES = STATES;
FinancialYearSchema.statics.FORWARD_TRANSITIONS = FORWARD_TRANSITIONS;

FinancialYearSchema.methods.isPostable = function isPostable() {
  // Journal posting is allowed in every state except Locked — Auditor Mode
  // adjustments (Phase 2.19) are the one exception to "Locked blocks all
  // writes" and are handled by that module's own guard, not this one.
  return this.status !== "Locked";
};

export default mongoose.models.FinancialYear ||
  mongoose.model("FinancialYear", FinancialYearSchema);
