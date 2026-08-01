import mongoose from "mongoose";

// Phase 2.5 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.2). One doc per {societyId, financialYearId, voucherType}. `lastNumber`
// is the last number actually allocated — always increment-then-read via
// $inc in a single findOneAndUpdate (see VoucherService.allocateVoucherNumber),
// never read-then-write in application code, or two concurrent requests can
// allocate the same number.
const VOUCHER_TYPES = ["Receipt", "Payment", "Journal", "Contra", "DebitNote", "CreditNote"];

const DocumentSequenceSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true },
    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    voucherType: { type: String, enum: VOUCHER_TYPES, required: true },
    lastNumber: { type: Number, default: 0 },
  },
  { timestamps: true },
);

DocumentSequenceSchema.index(
  { societyId: 1, financialYearId: 1, voucherType: 1 },
  { unique: true },
);

DocumentSequenceSchema.statics.VOUCHER_TYPES = VOUCHER_TYPES;

export default mongoose.models.DocumentSequence ||
  mongoose.model("DocumentSequence", DocumentSequenceSchema);
