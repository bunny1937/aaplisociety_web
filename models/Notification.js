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
    createdByName: { type: String, default: "System" },

    type: {
      type: String,
      required: true,
      enum: [
        // ── existing ──
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
        // ── visitor management ──
        "VISITOR_APPROVAL", // resident: someone is at the gate, approve/deny
        "VISITOR_DECISION", // guard: resident approved/denied
        "VISITOR_ENTERED", // resident: visitor has entered
        "VISITOR_EXITED", // resident: visitor has left
        "VISITOR_ESCALATION", // resident/admin: approval is being escalated
        "VISITOR_PASS", // resident: a pass was used
        "VISITOR_SOS", // everyone: panic/SOS raised
        "SECURITY_ALERT", // admin: contact unreachable / watchlist hit
        // ── tenant onboarding ──
        "TENANT_REQUEST_APPROVED", // owner: their tenant request was approved
        "TENANT_REQUEST_REJECTED", // owner: their tenant request was rejected
        // ── profile edit requests ──
        "PROFILE_EDIT_REQUEST_APPROVED", // owner: their Contact/Family/EmergencyContact change was approved
        "PROFILE_EDIT_REQUEST_REJECTED", // owner: their Contact/Family/EmergencyContact change was rejected
      ],
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 500 },

    priority: {
      type: String,
      enum: ["normal", "high", "critical"],
      default: "normal",
      index: true,
    },

    // Targeting
    recipientType: {
      type: String,
      required: true,
      enum: ["all", "member", "wing", "flats", "role", "user"],
    },
    // member:[memberId] · wing:[wingName] · flats:[memberId] · role:[roleName] · user:[userId]
    recipientIds: [{ type: String }],

    // Arbitrary structured payload (visitorId, photo, flatNo, action, …)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    readBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        readAt: { type: Date, default: Date.now },
      },
    ],

    actionUrl: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

NotificationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, sparse: true },
);
NotificationSchema.index({ societyId: 1, isDeleted: 1, createdAt: -1 });
NotificationSchema.index({ societyId: 1, recipientType: 1, createdAt: -1 });

export default mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);
