// lib/visitor-config.js
// Single source of truth for visitor-module constants.
export const VISITOR_PURPOSES = [
  "Guest",
  "Delivery",
  "Domestic Help",
  "Vendor",
  "Cab",
  "Other",
];
export const VISITOR_STATUSES = [
  "Pending",
  "Approved",
  "Rejected",
  "Entered",
  "Exited",
  "Expired",
];
// How long a resident has to respond before we auto-expire (and escalate).
export const APPROVAL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
// Gap between escalation ladder steps.
export const ESCALATION_STEP_MS = 30 * 1000; // 30 seconds
// Pass limits
export const PASS_MAX_USES_CAP = 100;
// Status → display color (used across all dashboards for consistency)
export const STATUS_COLOR = {
  Pending: "#f59e0b",
  Approved: "#10b981",
  Entered: "#3b82f6",
  Exited: "#6b7280",
  Rejected: "#ef4444",
  Expired: "#9ca3af",
};
export const PURPOSE_ICON = {
  Guest: "👤",
  Delivery: "📦",
  "Domestic Help": "🧹",
  Vendor: "🛠️",
  Cab: "🚕",
  Other: "❓",
};
export function isValidPurpose(p) {
  return VISITOR_PURPOSES.includes(p);
}
// Reject base64 blobs / oversized strings — photos must be uploaded URLs.
export function isSafePhotoValue(photo) {
  if (!photo) return true; // optional
  if (typeof photo !== "string") return false;
  if (photo.startsWith("data:")) return false;
  if (photo.length > 600) return false;
  return true;
}
