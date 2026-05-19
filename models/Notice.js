import mongoose from "mongoose";

const NoticeSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: { type: String, required: true },

    type: {
      type: String,
      required: true,
      enum: [
        "maintenance",
        "meeting",
        "water",
        "electricity",
        "parking",
        "security",
        "event",
        "billing",
        "custom",
      ],
      index: true,
    },
    priority: {
      type: String,
      required: true,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 150,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 30,
      maxlength: 2000,
    },

    pinned: { type: Boolean, default: false, index: true },

    // Read tracking
    viewedBy: [
      {
        memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member" },
        viewedAt: { type: Date, default: Date.now },
      },
    ],

    // Acknowledge tracking (urgent notices)
    acknowledgedBy: [
      {
        memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member" },
        acknowledgedAt: { type: Date, default: Date.now },
      },
    ],

    expiresAt: { type: Date },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// TTL index — MongoDB auto-removes expired notices
NoticeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound for main feed query
NoticeSchema.index({ societyId: 1, isDeleted: 1, pinned: -1, createdAt: -1 });
NoticeSchema.index({ societyId: 1, priority: 1, isDeleted: 1 });

export default mongoose.models.Notice || mongoose.model("Notice", NoticeSchema);
