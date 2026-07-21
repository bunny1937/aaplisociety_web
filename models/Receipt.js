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
