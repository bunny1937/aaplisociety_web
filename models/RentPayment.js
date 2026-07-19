import mongoose from "mongoose";

// Mirrors mobile-backend's RentPayment collection. Record-keeping only —
// "Online" is accepted as a paymentMode value with no gateway behind it yet.
const RentPaymentSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    recordedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: true },
    amount: { type: Number, required: true },
    paymentMode: { type: String, enum: ["Cash", "UPI", "BankTransfer", "Cheque", "Online"], required: true },
    paidAt: { type: Date, required: true },
    notes: String,
  },
  { timestamps: true },
);

export default mongoose.models.RentPayment || mongoose.model("RentPayment", RentPaymentSchema);
