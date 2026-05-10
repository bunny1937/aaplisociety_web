import mongoose from "mongoose";

const ComplaintSchema = new mongoose.Schema(
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
    anonymousName: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: [
        "noise",
        "parking",
        "water",
        "security",
        "cleanliness",
        "maintenance",
        "billing",
        "staff",
        "pets",
        "other",
      ],
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 30,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "CLOSED", "EXPIRED"],
      default: "PENDING",
      index: true,
    },
    adminRejectionReason: {
      type: String,
      trim: true,
      minlength: 120,
      maxlength: 500,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    replyCount: { type: Number, default: 0 },
    lastReplyAt: { type: Date },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true },
);

// TTL index — MongoDB auto-expires approved complaints after expiresAt
ComplaintSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes
ComplaintSchema.index({ societyId: 1, status: 1, createdAt: -1 });
ComplaintSchema.index({ societyId: 1, memberId: 1, createdAt: -1 });

export default mongoose.models.Complaint ||
  mongoose.model("Complaint", ComplaintSchema);
