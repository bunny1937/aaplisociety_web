import mongoose from "mongoose";

// Ledger V2 §8: every financial mutation writes exactly one immutable audit
// event in the SAME atomic operation as the mutation. Never mutation-then-log.
const AuditEventSchema = new mongoose.Schema(
  {
    billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill", required: true, index: true },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },

    eventType: {
      type: String,
      enum: ["BILL_GENERATED", "PAYMENT_ALLOCATED", "MANUAL_CORRECTION"],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    performedBy: { type: String, required: true }, // userId | "System" | "Cron" | "Script"
    calculationVersion: { type: Number, default: 1 },
    engineVersion: { type: String, default: "Ledger V2" },

    // BILL_GENERATED payload
    openingPrincipal: Number,
    openingInterest: Number,
    currentCharges: Number,
    currentInterest: Number,
    totalBillDue: Number,
    interestRateApplied: Number,

    // PAYMENT_ALLOCATED payload
    paymentAmount: Number,
    paymentImportId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentImport" },
    closingPrincipalBefore: Number,
    closingPrincipalAfter: Number,
    closingInterestBefore: Number,
    closingInterestAfter: Number,

    // MANUAL_CORRECTION payload
    reason: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

// §7 idempotency key: has this (bill, import) already produced a payment event?
AuditEventSchema.index(
  { billId: 1, paymentImportId: 1, eventType: 1 },
  { unique: true, partialFilterExpression: { paymentImportId: { $type: "objectId" } } },
);
AuditEventSchema.index({ billId: 1, timestamp: 1 });

export default mongoose.models.AuditEvent || mongoose.model("AuditEvent", AuditEventSchema);