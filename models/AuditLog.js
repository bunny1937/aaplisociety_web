import mongoose from "mongoose";

/**
 * Immutable audit trail.
 *
 * Note: userId/societyId are intentionally NOT required so that
 * pre-auth events (e.g. LOGIN_FAILURE for an unknown user) can still be
 * recorded without throwing.
 */
const AuditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: false,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        // ── existing ──
        "UPDATE_SOCIETY_CONFIG",
        "UPDATE_MATRIX_CONFIG",
        "GENERATE_BILLS",
        "RECORD_PAYMENT",
        "IMPORT_MEMBERS",
        "IMPORT_MEMBERS_ENHANCED",
        "UPDATE_MEMBER",
        "DELETE_MEMBER",
        "FINANCIAL_YEAR_CLOSE",
        "SECURITY_GUARD_CREATED",
        // ── auth ──
        "LOGIN_SUCCESS",
        "LOGIN_FAILURE",
        "LOGOUT",
        // ── security guard management ──
        "SECURITY_GUARD_UPDATED",
        "SECURITY_GUARD_DELETED",
        "SECURITY_GUARD_PASSWORD_RESET",
        // ── visitor management ──
        "VISITOR_CREATED",
        "VISITOR_APPROVED",
        "VISITOR_REJECTED",
        "VISITOR_ENTERED",
        "VISITOR_EXITED",
        "VISITOR_EXPIRED",
        "VISITOR_ESCALATED",
        "VISITOR_SOS",
        // ── offline visitor flow ──
        "VISITOR_OFFLINE_ENTRY",
        "VISITOR_ENTRY_CONFIRMED",
        "VISITOR_ENTRY_FLAGGED",
        // ── visitor passes ──
        "VISITOR_PASS_CREATED",
        "VISITOR_PASS_VERIFIED",
        "VISITOR_PASS_REVOKED",
        // ── watchlist ──
        "BLACKLIST_ADDED",
        "BLACKLIST_REMOVED",
        // ── contactability ──
        "MEMBER_CONTACT_FLAGGED",
        "MEMBER_CONTACT_CLEARED",
      ],
    },

    oldData: { type: mongoose.Schema.Types.Mixed },
    newData: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

export default mongoose.models.AuditLog ||
  mongoose.model("AuditLog", AuditLogSchema);
