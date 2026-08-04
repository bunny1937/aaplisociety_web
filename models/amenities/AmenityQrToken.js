import mongoose from "mongoose";

// amenity_qr_tokens — the QR credential printed and stuck on the amenity door.
//
// Only a SHA-256 hash of the token is stored. The plaintext is returned exactly
// once, at generation time, so it can be rendered into the printable QR; a
// leaked database dump therefore does not let anyone forge check-ins.
//
// `version` + `rotationIntervalMins` + `rotatesAt` exist unused today. They are
// the seam for dynamic QR rotation (a deferred feature): the verify path
// already compares against the active row, so rotation becomes a cron that
// mints a new version rather than a redesign.
const AmenityQrTokenSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    // Short public prefix carried in the QR payload so verification can find
    // the row by index rather than scanning every hash for the society.
    tokenPrefix: { type: String, required: true, index: true },
    mode: { type: String, enum: ["STATIC", "DYNAMIC"], default: "STATIC" },
    version: { type: Number, default: 1 },
    rotationIntervalMins: { type: Number, default: null },
    rotatesAt: { type: Date, default: null },
    label: { type: String, trim: true, maxlength: 80 },
    locationHint: { type: String, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, default: null },
    scanCount: { type: Number, default: 0 },
    lastScannedAt: { type: Date, default: null },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

// At most one active token per amenity per mode.
AmenityQrTokenSchema.index(
  { amenityId: 1, mode: 1, isActive: 1 },
  { partialFilterExpression: { isActive: true } },
);

export default mongoose.models.AmenityQrToken ||
  mongoose.model("AmenityQrToken", AmenityQrTokenSchema, "amenity_qr_tokens");
