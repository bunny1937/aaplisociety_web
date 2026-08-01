import mongoose from "mongoose";

// Phase 2.14 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.4, §8). A specialized wrapper around a Bank-subType ChartOfAccount —
// same "thin registry over a ledger account" shape as Fund.js (§Phase 2.13).
// No balance cached here either: the bank's ledger balance is always read
// live from the General Ledger; this model only carries the real-world
// account details (bank name, account number, branch) the ledger account
// itself has no room for.

const BankAccountSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    bankName: { type: String, required: true, trim: true },
    accountNumber: { type: String, required: true, trim: true },
    ifscCode: { type: String, trim: true },
    branch: { type: String, trim: true },
    linkedAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

BankAccountSchema.index({ societyId: 1, accountNumber: 1 }, { unique: true });
BankAccountSchema.index({ societyId: 1, linkedAccountId: 1 }, { unique: true });

export default mongoose.models.BankAccount || mongoose.model("BankAccount", BankAccountSchema);
