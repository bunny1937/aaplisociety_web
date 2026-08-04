import mongoose from "mongoose";

// amenity_visitors — a visitor's authorisation to use an amenity, distinct
// from the gate Visitor record (which is about entering the society).
//
// Separating the two matters: a guest may be inside the society all day but
// only permitted in the pool between 16:00 and 18:00, and the pool's visitor
// cap is independent of the gate.
const AmenityVisitorSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    // Sponsoring resident — every amenity visitor is someone's guest.
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Optional link to the gate record, when one exists.
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: "Visitor", default: null },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    visitorType: { type: String, trim: true, maxlength: 40, default: "Guest" },
    count: { type: Number, min: 1, default: 1 },

    validFrom: { type: Date, default: Date.now },
    validTo: { type: Date, default: null },

    approvalRequired: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED"],
      default: "APPROVED",
      index: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 300 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByRole: { type: String },
  },
  { timestamps: true },
);

AmenityVisitorSchema.index({ societyId: 1, amenityId: 1, status: 1, validFrom: -1 });
AmenityVisitorSchema.index({ memberId: 1, createdAt: -1 });

export default mongoose.models.AmenityVisitor ||
  mongoose.model("AmenityVisitor", AmenityVisitorSchema, "amenity_visitors");
