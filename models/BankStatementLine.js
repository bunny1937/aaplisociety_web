import mongoose from "mongoose";

// Phase 2.14 (docs/accounting-system-ARD.md §6.4). One row per imported bank
// statement transaction — never itself posted to the ledger (reconciliation
// verifies against what's already posted, it doesn't post anything new).
// `matchStatus` is a denormalized read convenience kept in sync by
// BankReconciliationService whenever a BankReconciliationMatch is
// created/confirmed/undone; the match record is the source of truth.

const TYPES = ["Debit", "Credit"];
const MATCH_STATUSES = ["Unmatched", "Pending", "Matched"];

const BankStatementLineSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true, index: true },
    date: { type: Date, required: true },
    description: { type: String, trim: true },
    refNo: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    type: { type: String, enum: TYPES, required: true },
    // Groups every line from one import (Excel upload) together.
    importBatchId: { type: String, required: true, trim: true, index: true },
    matchStatus: { type: String, enum: MATCH_STATUSES, default: "Unmatched", index: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

BankStatementLineSchema.index({ societyId: 1, bankAccountId: 1, date: 1 });

BankStatementLineSchema.statics.TYPES = TYPES;
BankStatementLineSchema.statics.MATCH_STATUSES = MATCH_STATUSES;

export default mongoose.models.BankStatementLine || mongoose.model("BankStatementLine", BankStatementLineSchema);
