import mongoose from "mongoose";

// Every scan attempt, valid or not. The brief asks the QR subsystem to store
// "QR Token, Resident, Time, Location, Validation Result" — that is an audit
// log of attempts, which cannot live on the token row (one token, many scans)
// nor on attendance (a rejected scan produces no attendance).
//
// This is also the only place a brute-force attempt against a token is visible.
const AmenityQrScanSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", default: null, index: true },
    tokenId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityQrToken", default: null },
    tokenPrefix: { type: String, default: null },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null, index: true },
    scannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    scannedByName: { type: String, default: "" },
    scannedByRole: { type: String, default: null },
    direction: { type: String, enum: ["IN", "OUT", null], default: null },
    result: {
      type: String,
      enum: [
        "VALID",
        "INVALID_TOKEN",
        "WRONG_SOCIETY",
        "REVOKED",
        "EXPIRED",
        "AMENITY_CLOSED",
        "OUTSIDE_HOURS",
        "CAPACITY_FULL",
        "NOT_ELIGIBLE",
        "ALREADY_CHECKED_IN",
        "NOT_CHECKED_IN",
        "ERROR",
      ],
      required: true,
      index: true,
    },
    reason: { type: String, trim: true, maxlength: 300 },
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityAttendance", default: null },
    // Client-reported free-text location (e.g. "Gym entrance"), not
    // coordinates - geofenced check-in is deferred scope.
    locationHint: { type: String, trim: true, maxlength: 150 },
    deviceInfo: { type: String, trim: true, maxlength: 200 },
    ip: { type: String, default: null },
    scannedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

AmenityQrScanSchema.index({ societyId: 1, amenityId: 1, scannedAt: -1 });
AmenityQrScanSchema.index({ societyId: 1, result: 1, scannedAt: -1 });

export default mongoose.models.AmenityQrScan ||
  mongoose.model("AmenityQrScan", AmenityQrScanSchema, "amenity_qr_scans");
