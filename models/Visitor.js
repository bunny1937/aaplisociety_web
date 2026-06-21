import mongoose from "mongoose";

/**
 * Visitor
 * One row per physical visit / entry request.
 *
 * Lifecycle:
 *   Pending → Approved → Entered → Exited
 *   Pending → Rejected
 *   Pending → Expired           (no response within approval window)
 *
 * Entry methods:
 *   Manual  — guard logged at the gate, needs resident approval
 *   Pass    — pre-approved via OTP/QR (auto-Entered)
 *   SOS     — created as part of an SOS/panic event
 */
const EscalationStepSchema = new mongoose.Schema(
  {
    level: { type: Number, required: true }, // 0-based ladder index
    channel: {
      type: String,
      enum: [
        "in_app",
        "push",
        "sms",
        "whatsapp",
        "email",
        "guard_call",
        "admin_alert",
      ],
      required: true,
    },
    target: { type: String, default: "" }, // phone / email / userId (never the secret)
    recipientRole: { type: String, default: "" }, // Owner | Tenant | Guard | Admin
    ok: { type: Boolean, default: false }, // delivery acknowledged by provider
    error: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const VisitorSchema = new mongoose.Schema(
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
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20, default: "" },
    photo: { type: String, trim: true, default: "" }, // stored URL only, never base64
    vehicleNumber: { type: String, trim: true, uppercase: true, default: "" },

    purpose: {
      type: String,
      enum: ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"],
      required: true,
    },
    purposeNote: { type: String, trim: true, maxlength: 300, default: "" },

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Entered", "Exited", "Expired"],
      default: "Pending",
      index: true,
    },

    entryMethod: {
      type: String,
      enum: ["Manual", "Pass", "SOS", "OfflineEntry"],
      default: "Manual",
      index: true,
    },
    offlineMeta: {
      wasOffline: { type: Boolean, default: false },
      queuedAt: { type: Date, default: null }, // when the guard captured it on-device
      syncedAt: { type: Date, default: null }, // when it reached the server
      note: { type: String, trim: true, maxlength: 500, default: "" },
      clientRef: { type: String, default: "" }, // de-dupe key from the device
      confirmation: {
        status: {
          type: String,
          enum: ["Pending", "Acknowledged", "Flagged"],
          default: "Pending",
        },
        at: { type: Date, default: null },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      },
    },
    // Pre-approved pass linkage (when entryMethod === 'Pass')
    passId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VisitorPass",
      default: null,
    },

    // Optional linkage to a complaint (e.g. vendor visiting for a repair)
    linkedComplaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      default: null,
    },

    // Watchlist snapshot at the time of entry (audit-safe even if list changes later)
    isBlacklisted: { type: Boolean, default: false },
    blacklistReason: { type: String, trim: true, default: "" },

    // Timing
    entryTime: { type: Date, default: Date.now, index: true },
    exitTime: { type: Date, default: null },
    // Resident approval window — after this, a Pending visit auto-Expires
    expiresAt: { type: Date, default: null, index: true },

    // Decision audit
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    approverRole: { type: String, default: "" }, // Owner | Tenant | Admin

    enteredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // guard
    gateLabel: { type: String, trim: true, default: "Main Gate" },

    // Zero-dead-end escalation ladder state
    escalation: {
      level: { type: Number, default: 0 },
      stopped: { type: Boolean, default: false },
      lastNotifiedAt: { type: Date, default: null },
      history: { type: [EscalationStepSchema], default: [] },
    },
  },
  { timestamps: true },
);

VisitorSchema.index({ societyId: 1, createdAt: -1 });
VisitorSchema.index({ societyId: 1, memberId: 1, createdAt: -1 });
VisitorSchema.index({ societyId: 1, status: 1, createdAt: -1 });
// For the escalation sweeper: find Pending visits whose window is closing.
VisitorSchema.index({ status: 1, expiresAt: 1, "escalation.stopped": 1 });
VisitorSchema.index(
  { societyId: 1, "offlineMeta.clientRef": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "offlineMeta.clientRef": { $type: "string", $gt: "" },
    },
  },
);
export default mongoose.models.Visitor ||
  mongoose.model("Visitor", VisitorSchema);
