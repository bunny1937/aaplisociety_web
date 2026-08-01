import mongoose from "mongoose";

// Phase 2.12 of the accounting-system revamp (docs/accounting-system-ARD.md
// §3, §7, §8). Liability Register — outstanding vendors, loans, deposits,
// advance collections, statutory taxes. Every financial action (incurring the
// liability, paying it down) posts through AccountingEngine.process() (§6.10)
// via LiabilityService — this model's financial fields are never written
// directly by a route.
//
// Counterparty uses the generic {partyType, partyRef} pair (§6.16
// multi-entity foundation) rather than a hardcoded vendorId/memberId, so a
// future Vendor/Employee module reuses this register without rework.

const TYPES = ["VendorPayable", "Loan", "Deposit", "AdvanceCollection", "StatutoryTax", "Other"];
const PARTY_TYPES = ["Member", "Vendor", "Builder", "Tenant", "Employee", "Bank", "GovernmentAuthority"];
const STATUSES = ["Open", "Closed"];

const LiabilitySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    liabilityCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: TYPES, required: true },
    description: { type: String, trim: true },

    partyType: { type: String, enum: PARTY_TYPES, default: null },
    partyRef: { type: mongoose.Schema.Types.ObjectId, default: null },

    incurredDate: { type: Date, required: true },
    principalAmount: { type: Number, required: true, min: 0.01 },
    outstandingAmount: { type: Number, required: true, min: 0 },
    interestRate: { type: Number, default: null }, // annual %, loans only
    dueDate: { type: Date, default: null },

    // Chart-of-Accounts wiring — resolved once when the liability is incurred.
    linkedLiabilityAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },

    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    incurredVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", default: null },

    status: { type: String, enum: STATUSES, default: "Open" },

    payments: [
      {
        date: { type: Date, required: true },
        amount: { type: Number, required: true },
        payingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        voucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher" },
        note: { type: String, trim: true },
      },
    ],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

LiabilitySchema.index({ societyId: 1, liabilityCode: 1 }, { unique: true });
LiabilitySchema.index({ societyId: 1, type: 1, status: 1 });
LiabilitySchema.index({ partyType: 1, partyRef: 1 });

LiabilitySchema.statics.TYPES = TYPES;
LiabilitySchema.statics.PARTY_TYPES = PARTY_TYPES;
LiabilitySchema.statics.STATUSES = STATUSES;

export default mongoose.models.Liability || mongoose.model("Liability", LiabilitySchema);
