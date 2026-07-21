// Feature kill switches + cron auth, ported from mobile-backend config/env.ts.
// Both write switches default OFF (the mobile backend shipped them off) so the
// /v1 layer cannot mutate billing/complaint state until explicitly enabled.
export function billWritesEnabled() {
  return process.env.BILL_WRITES_ENABLED === "true";
}

export function complaintStatusWritesEnabled() {
  return process.env.COMPLAINT_STATUS_WRITES_ENABLED === "true";
}

// Cron endpoints: if CRON_SECRET is set, require a matching Bearer token
// (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`). If unset, allow
// (dev convenience).
export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}
