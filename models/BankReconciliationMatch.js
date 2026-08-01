import mongoose from "mongoose";

// Phase 2.14 (docs/accounting-system-ARD.md §6.4). Links one BankStatementLine
// to one GL JournalLine. Absence of an active match row IS "Unmatched" — this
// collection only stores rows once a pairing has been suggested or confirmed,
// so status only ever moves Pending -> Matched (or gets soft-deleted to undo).
// Partial unique indexes below stop the same statement line or journal line
// from being matched twice at once, without blocking rematching after an
// undo (isDeleted: true rows fall outside the partial filter).

const STATUSES = ["Pending", "Matched"];

const BankReconciliationMatchSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    bankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BankAccount", required: true, index: true },
    bankStatementLineId: { type: mongoose.Schema.Types.ObjectId, ref: "BankStatementLine", required: true },
    journalLineId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalLine", required: true },
    matchedAmount: { type: Number, required: true },
    status: { type: String, enum: STATUSES, default: "Pending" },
    matchedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    matchedAt: { type: Date, default: null },
    note: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

BankReconciliationMatchSchema.index(
  { bankStatementLineId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
BankReconciliationMatchSchema.index(
  { journalLineId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

BankReconciliationMatchSchema.statics.STATUSES = STATUSES;

export default mongoose.models.BankReconciliationMatch ||
  mongoose.model("BankReconciliationMatch", BankReconciliationMatchSchema);
