import mongoose from "mongoose";
const BillSchema = new mongoose.Schema(
  {
    billPeriodId: {
      type: String,
      required: true,
      index: true,
    },
    billMonth: {
      type: Number,
      required: true,
      min: 0,
      max: 12,
    },
    billYear: {
      type: Number,
      required: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // ── Immutable bill-state fields (set at generation, never mutated) ──────
    // openingPrincipal = previous month's closingPrincipal
    openingPrincipal: { type: Number, default: 0 },
    // openingInterest = previous month's closingInterest
    openingInterest: { type: Number, default: 0 },
    // currentCharges = sum of this month's maintenance + fixed + custom heads
    currentCharges: { type: Number, default: 0 },
    // currentInterest = openingPrincipal × annualRate / 1200 (simple, non-compounding)
    currentInterest: { type: Number, default: 0 },
    // billPrincipalBalance = openingPrincipal + currentCharges (immutable)
    billPrincipalBalance: { type: Number, default: 0 },
    // billInterestBalance = openingInterest + currentInterest (immutable)
    billInterestBalance: { type: Number, default: 0 },
    // totalBillDue = billPrincipalBalance + billInterestBalance (immutable)
    totalBillDue: { type: Number, default: 0 },
    // ── Closing-state fields (set after payment, separate from bill state) ──
    closingPrincipal: { type: Number, default: null },
    closingInterest: { type: Number, default: null },
    closingTotal: { type: Number, default: null },
    paymentUploadedAt: { type: Date, default: null },
    paymentImportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentImport",
      default: null,
    },
    // ── Legacy / compat fields (kept for existing generate route + reports) ─
    previousBalance: { type: Number, default: 0 },
    previousPrincipal: { type: Number, default: 0 },
    previousInterest: { type: Number, default: 0 },
    currInt: { type: Number, default: 0 },
    monthInterest: { type: Number, default: 0 },
    interestAmount: { type: Number, default: 0 },
    principalBalance: { type: Number, default: 0 },
    interestBalance: { type: Number, default: 0 },
    subtotal: Number,
    serviceTax: { type: Number, default: 0 },
    currentBillTotal: Number,
    charges: {
      type: Map,
      of: Number,
      default: new Map(),
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceAmount: {
      type: Number,
      required: true,
    },
    advanceApplied: { type: Number, default: 0 },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      // Scheduled: generated but not yet visible to member (pushDate not reached)
      enum: ["Scheduled", "Unpaid", "Partial", "Paid", "Overdue"],
      default: "Unpaid",
      index: true,
    },
    // Set when bill is generated before billPushDay. Cron flips to 'Unpaid' on this date.
    scheduledPushDate: { type: Date, default: null },
    importedFrom: {
      type: String,
      enum: ["Manual", "Excel", "API", "System", "BulkImport"],
      default: "System",
    },
    importBatchId: { type: String }, // ❌ REMOVED: index: true
    importMetadata: {
      fileName: String,
      uploadedAt: Date,
      rowNumber: Number,
      validationStatus: {
        type: String,
        enum: ["Valid", "Warning", "Error"],
        default: "Valid",
      },
      validationMessages: [String],
    },
    generationMetadata: {
      societyConfigVersion: Number,
      memberAreaAtGeneration: Number,
      ratesApplied: mongoose.Schema.Types.Mixed,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    isHistoricalArchive: {
      type: Boolean,
      default: false,
      index: true,
    },
    importedFinancialYear: {
      type: String, // e.g. "2024-2025"
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    lastModifiedAt: {
      type: Date,
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      trim: true,
    },
    interestOverrideReason: { type: String, trim: true, default: null },
    interestOverridden: { type: Boolean, default: false },
    billPdfUrl: String,
    billHtml: String, // Stored HTML for preview and print
    renderedHtml: { type: String, select: false }, // stored but not returned by default
    // Soft delete - NO INDEX HERE
    isDeleted: { type: Boolean, default: false }, // ❌ REMOVED: index: true
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
  },
);
// ✅ ALL INDEXES DEFINED HERE (single place)
BillSchema.index(
  { societyId: 1, billPeriodId: 1, memberId: 1 },
  { unique: true },
);
BillSchema.index({ societyId: 1, status: 1, dueDate: 1 });
BillSchema.index({ status: 1, scheduledPushDate: 1 }); // for cron job query
BillSchema.index({ importBatchId: 1 }); // ✅ Defined here only
BillSchema.index({ "importMetadata.validationStatus": 1 });
BillSchema.index({ isDeleted: 1 }); // ✅ Defined here only
BillSchema.pre("save", function (next) {
  // Only auto-compute balanceAmount on fresh bills (no payments yet).
  // Once amountPaid > 0, the payment engine owns balanceAmount — don't clobber it.
  if ((this.amountPaid || 0) === 0) {
    this.balanceAmount = parseFloat(
      Math.max(
        0,
        (this.principalBalance || 0) +
          (this.interestBalance || 0) -
          (this.advanceApplied || 0),
      ).toFixed(2),
    );
  }
  this.interestAmount = this.monthInterest || this.interestAmount || 0;
  next();
});
export default mongoose.models.Bill || mongoose.model("Bill", BillSchema);
