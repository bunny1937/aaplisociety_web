import mongoose from "mongoose";

// Phase 2.8 — one row per debit/credit line. Several fields are denormalized
// from the parent JournalEntry (societyId, financialYearId, voucherId, date,
// status) precisely so the General Ledger and Trial Balance are pure
// aggregations over THIS collection — "reports just aggregate ledger
// balances" (§1), no joins. The trade-off: reversal/cancel must update the
// lines' status too (JournalEngine handles that inside its transaction).
//
// Counterparty is stored generically as { partyType, partyRef } (§6.16
// multi-entity foundation), never a hardcoded memberId — so a future Vendor
// or Employee sub-ledger reuses this same collection.
const JournalLineSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true },
    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", required: true, index: true },
    voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    side: { type: String, enum: ["Debit", "Credit"], required: true },
    amount: { type: Number, required: true, min: 0 },
    partyType: {
      type: String,
      enum: ["Member", "Vendor", "Builder", "Tenant", "Employee", "Bank", "GovernmentAuthority", null],
      default: null,
    },
    partyRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    narration: { type: String, trim: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ["Draft", "Posted", "Reversed", "Cancelled"], default: "Posted" },
  },
  { timestamps: true },
);

// Ledger drill-down by account, over a date range, filtered by status.
JournalLineSchema.index({ societyId: 1, accountId: 1, status: 1, date: 1 });
// Trial-balance aggregation scoped to a financial year.
JournalLineSchema.index({ societyId: 1, financialYearId: 1, status: 1 });

export default mongoose.models.JournalLine ||
  mongoose.model("JournalLine", JournalLineSchema);
