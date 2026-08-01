import mongoose from "mongoose";

// Phase 2.11 of the accounting-system revamp (docs/accounting-system-ARD.md
// §3, §8). The Asset Register — purchase, depreciation, transfer, disposal,
// current value, vendor, bills. Every financial action on an asset (purchase,
// depreciation run, disposal) posts through AccountingEngine.process()
// (§6.10) via AssetService — this model never gets its ledger-affecting
// fields written directly by a route.

const DEPRECIATION_METHODS = ["StraightLine", "WDV"];
const STATUSES = ["Active", "Disposed"];

const AssetSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    assetCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "Other" },
    description: { type: String, trim: true },

    purchaseDate: { type: Date, required: true },
    purchaseCost: { type: Number, required: true, min: 0.01 },
    vendor: { type: String, trim: true },
    billRef: { type: String, trim: true },

    usefulLifeYears: { type: Number, required: true, min: 1 },
    salvageValue: { type: Number, default: 0, min: 0 },
    depreciationMethod: { type: String, enum: DEPRECIATION_METHODS, required: true },
    // WDV rate (annual %, e.g. 15 for 15%). Only meaningful when
    // depreciationMethod === "WDV" — StraightLine derives its own rate from
    // (cost - salvage) / usefulLifeYears.
    wdvRatePercent: { type: Number, default: null },

    accumulatedDepreciation: { type: Number, default: 0, min: 0 },

    // Chart-of-Accounts wiring — resolved once at purchase time, not looked
    // up again on every depreciation run, so an account remap later doesn't
    // retroactively change where this asset posts.
    linkedAssetAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    linkedDepreciationExpenseAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    linkedAccumulatedDepreciationAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    fundingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },

    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    purchaseVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", default: null },

    status: { type: String, enum: STATUSES, default: "Active" },
    location: { type: String, trim: true },
    custodian: { type: String, trim: true },

    transferHistory: [
      {
        date: { type: Date, default: Date.now },
        fromLocation: { type: String, trim: true },
        toLocation: { type: String, trim: true },
        fromCustodian: { type: String, trim: true },
        toCustodian: { type: String, trim: true },
        note: { type: String, trim: true },
        byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],

    depreciationRuns: [
      {
        date: { type: Date, required: true },
        financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear" },
        amount: { type: Number, required: true },
        method: { type: String, enum: DEPRECIATION_METHODS },
        voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher" },
      },
    ],

    disposal: {
      date: { type: Date, default: null },
      proceeds: { type: Number, default: null },
      gainLoss: { type: Number, default: null },
      gainLossAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
      disposalAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
      voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", default: null },
      note: { type: String, trim: true },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

AssetSchema.index({ societyId: 1, assetCode: 1 }, { unique: true });
AssetSchema.index({ societyId: 1, status: 1 });

/** Book value right now: purchase cost less accumulated depreciation. */
AssetSchema.methods.currentValue = function () {
  return Math.round((this.purchaseCost - this.accumulatedDepreciation) * 100) / 100;
};

AssetSchema.statics.DEPRECIATION_METHODS = DEPRECIATION_METHODS;
AssetSchema.statics.STATUSES = STATUSES;

export default mongoose.models.Asset || mongoose.model("Asset", AssetSchema);
