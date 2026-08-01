import mongoose from "mongoose";

// Phase 2.13 of the accounting-system revamp (docs/accounting-system-ARD.md
// §3, §8). Fund Management — Reserve, Repair, Corpus, Share Capital, General
// Fund, Sinking Fund. This model is a thin registry (metadata + which
// ChartOfAccount the fund maps to); its balance is intentionally NOT cached
// here. Balance is always the linked account's General Ledger closing
// balance (Phase 2.9's getAccountLedger) — computed live, never stored a
// second time, so it can never drift from the ledger (§7 "General Ledger
// remains derived... to keep the ledger as the single source of truth
// without a second place that can drift" — the same reasoning applies one
// level up here). Every balance-affecting action (contribution, drawdown,
// inter-fund transfer) posts through AccountingEngine.process() via
// FundService, so "balances updated only through the Accounting Engine"
// (§8 Phase 2.13) holds by construction, not by convention.

const FUND_TYPES = ["ReserveFund", "SinkingFund", "RepairFund", "CorpusFund", "ShareCapital", "GeneralFund", "Other"];

const FundSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    fundCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    fundType: { type: String, enum: FUND_TYPES, required: true },
    // The Equity/Fund-type ChartOfAccount this register wraps. One fund per
    // account — enforced by the unique index below.
    linkedAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    purpose: { type: String, trim: true },
    targetAmount: { type: Number, default: null, min: 0 },
    // Soft floor enforced by FundService before a drawdown/transfer-out is
    // allowed to post. Not a hard ledger constraint — an admin can still
    // raise/lower it as fund policy changes.
    minimumBalance: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

FundSchema.index({ societyId: 1, fundCode: 1 }, { unique: true });
FundSchema.index({ societyId: 1, linkedAccountId: 1 }, { unique: true });

FundSchema.statics.FUND_TYPES = FUND_TYPES;

export default mongoose.models.Fund || mongoose.model("Fund", FundSchema);
