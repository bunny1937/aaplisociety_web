import mongoose from "mongoose";

// Phase 2.8 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.7, §6.8, §7). The double-entry record beneath a Voucher (1:1). The
// actual debit/credit rows live in the separate JournalLine collection so the
// General Ledger (Phase 2.9) and Trial Balance (Phase 2.15) can aggregate by
// account with no joins — this header stores the totals and metadata.
//
// status mirrors the owning Voucher (Voucher is the source of truth, §6.7).
// A JournalEntry only ever exists for a Posted (later possibly Reversed)
// voucher — Draft vouchers carry no entry.
const STATUSES = ["Draft", "Posted", "Reversed", "Cancelled"];

const JournalEntrySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true, index: true },
    voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", required: true },
    date: { type: Date, required: true },
    narration: { type: String, trim: true },
    totalDebit: { type: Number, required: true },
    totalCredit: { type: Number, required: true },
    lineCount: { type: Number, required: true },
    status: { type: String, enum: STATUSES, default: "Posted", index: true },
    sourceModule: { type: String, required: true },
    sourceRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    reversalOfJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    reversedByJournalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

// 1:1 with Voucher.
JournalEntrySchema.index({ voucherId: 1 }, { unique: true });

JournalEntrySchema.statics.STATUSES = STATUSES;
// Statuses that count toward ledger/trial-balance balances. A reversed entry
// still counts — its offsetting reversal entry (also counted) nets it to zero;
// Draft/Cancelled entries never posted, so they're excluded.
JournalEntrySchema.statics.BALANCE_STATUSES = ["Posted", "Reversed"];

export default mongoose.models.JournalEntry ||
  mongoose.model("JournalEntry", JournalEntrySchema);
