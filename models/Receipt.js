import mongoose from "mongoose";
const ReceiptSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, required: true, unique: true },
    filename: { type: String, required: true },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      required: true,
    },
    billPeriodId: { type: String, required: true },
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
    amount: { type: Number, required: true },
    amountReceived: { type: Number, default: 0 },
    amountApplied: { type: Number, default: 0 },
    interestApplied: { type: Number, default: 0 },
    principalApplied: { type: Number, default: 0 },
    advanceCreditCreated: { type: Number, default: 0 },
    remainingBalance: { type: Number, default: 0 },
    settlementStatus: { type: String, enum: ["Paid", "Partial"], default: "Paid" },
    previousBalanceSnapshot: { type: Number, default: 0 },
    paymentMode: { type: String, default: "Online" },
    paidAt: { type: Date, default: Date.now },
    transactionId: { type: String },
    notes: { type: String },
    status: {
      type: String,
      enum: ["Generated", "Downloaded"],
      default: "Generated",
    },
  },
  { timestamps: true },
);
ReceiptSchema.index({ memberId: 1, societyId: 1, paidAt: -1 });
export default mongoose.models.Receipt ||
  mongoose.model("Receipt", ReceiptSchema);