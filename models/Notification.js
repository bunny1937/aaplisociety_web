import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
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
    createdByName: { type: String, default: "Admin" },

    type: {
      type: String,
      required: true,
      enum: [
        "BILL_GENERATED",
        "PAYMENT_RECEIVED",
        "PAYMENT_FAILED",
        "DUE_REMINDER",
        "NOTICE_POSTED",
        "COMPLAINT_APPROVED",
        "COMPLAINT_REJECTED",
        "MAINTENANCE_ALERT",
        "ADMIN_MESSAGE",
        "CUSTOM",
      ],
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 500 },

    // Targeting
    recipientType: {
      type: String,
      required: true,
      enum: ["all", "member", "wing", "flats"],
    },
    // For member: [memberId], wing: [wingName], flats: [flatIds], all: []
    recipientIds: [{ type: String }],

    // Read tracking — array of userIds who read it
    readBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        readAt: { type: Date, default: Date.now },
      },
    ],

    actionUrl: { type: String, default: null },

    expiresAt: { type: Date, index: true, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// TTL for auto-expiry (expiresAt set per notification)
NotificationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, sparse: true },
);
NotificationSchema.index({ societyId: 1, isDeleted: 1, createdAt: -1 });

export default mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);
