import mongoose from "mongoose";
/**
 * Blacklist / Watchlist — society-scoped list of visitors who should be
 * flagged (and optionally blocked) at the gate.
 *
 * Matching is done on a normalized phone number (preferred) and/or name.
 */
const BlacklistSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    name: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "", index: true }, // normalized digits
    reason: { type: String, trim: true, required: true, maxlength: 300 },
    photo: { type: String, trim: true, default: "" },
    // 'flag' = allow but warn the guard · 'block' = deny entry outright
    severity: {
      type: String,
      enum: ["flag", "block"],
      default: "flag",
      index: true,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);
BlacklistSchema.index({ societyId: 1, phone: 1, active: 1 });
BlacklistSchema.index({ societyId: 1, active: 1, createdAt: -1 });
// Normalize a phone to comparable digits (last 10).
BlacklistSchema.statics.normalizePhone = function (phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
export default mongoose.models.Blacklist ||
  mongoose.model("Blacklist", BlacklistSchema);
