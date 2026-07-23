import mongoose from "mongoose";
const PaymentImportRowSchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member" },
    flatNo: String,
    wing: String,
    ownerName: String,
    amountPaid: { type: Number, default: 0 },
    paymentDate: Date,
    paymentMethod: { type: String, default: "Cash" },
    chequeNo: String,
    bankName: String,
    upiId: String,
    remarks: String,
    status: { type: String, enum: ["Success", "Failed", "Skipped"], default: "Success" },
    errorMessage: String,
    billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill" },
    interestCleared: { type: Number, default: 0 },
    principalCleared: { type: Number, default: 0 },
    advanceCredit: { type: Number, default: 0 },
  },
  { _id: false },
);
const PaymentImportSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    importMonth: { type: Number, required: true }, // 1-indexed
    importYear: { type: Number, required: true },
    billPeriodId: { type: String, required: true, index: true },
    uploadedFileName: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
    // Ledger V2 §7/§9: content signature of the uploaded rows. A unique index on
    // { societyId, contentHash } rejects re-uploads of the same file so payments
    // can never be applied twice across separate upload requests.
    contentHash: { type: String, default: null },
    totalRows: { type: Number, default: 0 },
    successRows: { type: Number, default: 0 },
    failedRows: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },
    totalAmountUploaded: { type: Number, default: 0 },
    totalInterestCleared: { type: Number, default: 0 },
    totalPrincipalCleared: { type: Number, default: 0 },
    totalAdvanceCredit: { type: Number, default: 0 },
    rows: [PaymentImportRowSchema],
    status: {
      type: String,
      enum: ["Pending", "Processing", "Completed", "Failed"],
      default: "Completed",
    },
    notes: String,
    purgeAt: { type: Date, default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true },
);
PaymentImportSchema.index({ societyId: 1, importYear: 1, importMonth: 1 });
PaymentImportSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
// Import-level idempotency: one completed/processing import per (society, file
// signature). Partial index so legacy rows with a null contentHash are exempt.
PaymentImportSchema.index(
  { societyId: 1, contentHash: 1 },
  {
    unique: true,
    partialFilterExpression: { contentHash: { $type: "string" } },
  },
);
export default mongoose.models.PaymentImport ||
  mongoose.model("PaymentImport", PaymentImportSchema);