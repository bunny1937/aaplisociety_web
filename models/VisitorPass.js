// models/VisitorPass.js
import mongoose from "mongoose";
import crypto from "crypto";
/**
 * VisitorPass — pre-approval issued by a resident so a visitor can enter
 * without a live approval at the gate.
 *
 * Two independent credentials are supported (either verifies the pass):
 *   - OTP  : 6-digit code (hashed at rest)
 *   - QR   : opaque token embedded in a QR image (hashed at rest)
 *
 * Pass types:
 *   OneTime   — single use within a validity window
 *   Recurring — valid on selected weekdays within a daily time window
 *   Frequent  — multi-use (maxUses) within a validity window (e.g. domestic help)
 */
const RecurrenceSchema = new mongoose.Schema(
  {
    // 0 = Sunday … 6 = Saturday
    days: { type: [Number], default: [] },
    startTime: { type: String, default: "00:00" }, // "HH:mm" local
    endTime: { type: String, default: "23:59" }, // "HH:mm" local
  },
  { _id: false },
);
const VisitorPassSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    visitorName: { type: String, required: true, trim: true },
    visitorPhone: { type: String, trim: true },
    visitorPhoto: { type: String }, // URL
    vehicleNumber: { type: String, trim: true, uppercase: true, default: "" },
    purpose: {
      type: String,
      enum: ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"],
      default: "Guest",
    },
    note: { type: String, trim: true },
    passType: {
      type: String,
      enum: ["OneTime", "Recurring", "Frequent"],
      default: "OneTime",
    },
    recurrence: { type: RecurrenceSchema, default: null },
    // Validity window
    validFrom: { type: Date, required: true },
    expiresAt: { type: Date, required: true, index: true },
    // Use control
    maxUses: { type: Number, default: 1 }, // 0 = unlimited within window
    usedAt: [{ type: Date }],
    // Credentials (hashed). Raw values are returned ONCE on creation.
    otpHash: { type: String, required: true, index: true },
    qrTokenHash: { type: String, index: true },
    status: {
      type: String,
      enum: ["Active", "Used", "Expired", "Revoked"],
      default: "Active",
      index: true,
    },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
VisitorPassSchema.index({ societyId: 1, memberId: 1, status: 1 });
VisitorPassSchema.index({ otpHash: 1, status: 1 });
VisitorPassSchema.index({ qrTokenHash: 1, status: 1 });
function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
// 6-digit OTP
VisitorPassSchema.statics.generateOTP = function () {
  const otp = String(crypto.randomInt(100000, 1000000));
  return { otp, otpHash: sha256(otp) };
};
// Opaque QR token (32 bytes, url-safe)
VisitorPassSchema.statics.generateQRToken = function () {
  const token = crypto.randomBytes(24).toString("base64url");
  return { token, qrTokenHash: sha256(token) };
};
VisitorPassSchema.statics.hashCredential = sha256;
VisitorPassSchema.methods.verifyOTP = function (plain) {
  return !!plain && sha256(plain) === this.otpHash;
};
VisitorPassSchema.methods.verifyQR = function (token) {
  return !!token && !!this.qrTokenHash && sha256(token) === this.qrTokenHash;
};
/**
 * Returns true if the pass is currently usable (window + recurrence + uses).
 * `now` is injectable for testing.
 */
VisitorPassSchema.methods.isUsableNow = function (now = new Date()) {
  if (this.status !== "Active") return false;
  if (now < this.validFrom || now > this.expiresAt) return false;
  if (this.maxUses > 0 && this.usedAt.length >= this.maxUses) return false;
  if (this.passType === "Recurring" && this.recurrence) {
    const day = now.getDay();
    if (this.recurrence.days?.length && !this.recurrence.days.includes(day))
      return false;
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    if (
      this.recurrence.startTime &&
      this.recurrence.endTime &&
      (hhmm < this.recurrence.startTime || hhmm > this.recurrence.endTime)
    )
      return false;
  }
  return true;
};
export default mongoose.models.VisitorPass ||
  mongoose.model("VisitorPass", VisitorPassSchema);
