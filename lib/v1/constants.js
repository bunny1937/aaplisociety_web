// Ported from @aapli/constants (mobile-backend shared-constants package).
// Single source of truth for roles, statuses, notification types, and socket
// room names used across the /v1 (mobile) API layer.

export const ROLES = {
  SUPER_ADMIN: "SuperAdmin",
  ADMIN: "Admin",
  SECRETARY: "Secretary",
  ACCOUNTANT: "Accountant",
  SECURITY: "Security",
  MEMBER: "Member",
};

export const SOCIETY_ADMIN_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];
export const BILLING_WRITE_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];
export const VISITOR_ACCESS_ROLES = [ROLES.ADMIN, ROLES.SECRETARY, ROLES.SECURITY];

export const OCCUPANCY_TYPES = { OWNER: "Owner", TENANT: "Tenant" };

export const BILL_STATUS = {
  SCHEDULED: "Scheduled",
  UNPAID: "Unpaid",
  PARTIAL: "Partial",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export const VISITOR_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  ENTERED: "Entered",
  EXITED: "Exited",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
};

export const NOTIFICATION_TYPES = {
  BILL_GENERATED: "BILL_GENERATED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  NOTICE_POSTED: "NOTICE_POSTED",
  COMPLAINT_APPROVED: "COMPLAINT_APPROVED",
  COMPLAINT_REJECTED: "COMPLAINT_REJECTED",
  VISITOR_APPROVAL: "VISITOR_APPROVAL",
  VISITOR_DECISION: "VISITOR_DECISION",
  VISITOR_ENTERED: "VISITOR_ENTERED",
  VISITOR_EXITED: "VISITOR_EXITED",
  VISITOR_ESCALATION: "VISITOR_ESCALATION",
  VISITOR_PASS: "VISITOR_PASS",
  VISITOR_SOS: "VISITOR_SOS",
  SECURITY_ALERT: "SECURITY_ALERT",
  TENANT_LEASE_EXPIRED: "TENANT_LEASE_EXPIRED",
  GUARD_MESSAGE: "GUARD_MESSAGE",
  VISITOR_REASSIGNED: "VISITOR_REASSIGNED",
};

export const RECIPIENT_TYPES = ["all", "member", "wing", "flats", "role", "user"];
export const DELIVERY_CHANNELS = ["in_app", "push", "sms", "whatsapp", "email", "guard_call", "admin_alert"];

// Retained for parity/documentation. In the Vercel deployment there is no
// Socket.IO server, so these room names are no longer used to emit realtime
// events; the Flutter client polls instead (see V1_MIGRATION.md).
export const room = {
  society: (societyId) => `society_${societyId}`,
  member: (memberId) => `member_${memberId}`,
  security: (societyId) => `security_${societyId}`,
  user: (userId) => `user_${userId}`,
  wing: (societyId, wing) => `wing_${societyId}_${wing}`,
};
