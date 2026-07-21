import mongoose from "mongoose";
const TenantRequestDocumentsSchema = new mongoose.Schema(
  {
    contractKey: String,
    signatureKey: String,
    aadhaarKey: String,
    policeVerificationKey: String,
  },
  { _id: false },
);
// Mirrors mobile-backend's TenantRequest collection (apps/mobile-backend/src/models/index.ts).
// Owner-submitted, admin-pending tenant onboarding data — deliberately its own
// collection, not written onto Member.currentTenant, until this app's approve
// route below accepts it.
const TenantRequestSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tenantName: { type: String, required: true },
    tenantPhone: { type: String, required: true },
    tenantEmail: { type: String, required: true },
    leaseStartDate: { type: Date, required: true },
    leaseEndDate: { type: Date, required: true },
    rentPerMonth: { type: Number, required: true },
    depositAmount: { type: Number, default: 0 },
    documents: TenantRequestDocumentsSchema,
    status: { type: String, enum: ["Pending", "Approved", "Rejected", "Closed"], default: "Pending", index: true },
    rejectionReason: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
    leaseExpiredAt: Date,
    ownerConfirmedMoveOutAt: Date,
    adminConfirmedMoveOutAt: Date,
  },
  { timestamps: true },
);
export default mongoose.models.TenantRequest || mongoose.model("TenantRequest", TenantRequestSchema);
