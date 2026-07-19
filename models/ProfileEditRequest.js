import mongoose from "mongoose";

// Mirrors mobile-backend's ProfileEditRequest collection
// (apps/mobile-backend/src/models/index.ts in the AapliSociety_App mobile
// monorepo — see that repo's docs/superpowers/specs/2026-07-19-profile-restructure-design.md).
// Owner-submitted, admin-pending change to Contact / FamilyMember /
// EmergencyContact on the shared Member document — deliberately its own
// collection, not written onto Member directly, until this app's approve
// route below accepts it.
const ProfileEditRequestSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    section: { type: String, enum: ["Contact", "FamilyMember", "EmergencyContact"], required: true },
    action: { type: String, enum: ["Edit", "Add", "Remove"], required: true },
    familyMemberId: mongoose.Schema.Types.ObjectId,
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending", index: true },
    rejectionReason: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
  },
  { timestamps: true },
);

export default mongoose.models.ProfileEditRequest || mongoose.model("ProfileEditRequest", ProfileEditRequestSchema);
