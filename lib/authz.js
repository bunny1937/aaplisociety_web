import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getTokenFromRequest, verifyToken } from "./jwt";
export const SOCIETY_ADMIN_ROLES = ["Admin", "Secretary"];
export const BILLING_WRITE_ROLES = ["Admin", "Secretary"];
// Accounting-module routes (Phase 2 of the accounting-system revamp — see
// docs/accounting-system-ARD.md §7). "Accountant" is a role that already
// existed as an unused constant in lib/v1/constants.js; this is the first
// place it's actually wired into an access-control check.
export const ACCOUNTING_ROLES = ["Admin", "Secretary", "Accountant"];
// Financial Year state transitions and other higher-stakes accounting
// actions (locking, approval) are Admin/Secretary only — Accountant can
// operate day-to-day accounting but not close/lock a period.
export const ACCOUNTING_CLOSE_ROLES = ["Admin", "Secretary"];
function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}
function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}
export function requireAuth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return unauthorized();
  const decoded = verifyToken(token);
  if (!decoded) return unauthorized("Invalid token");
  return { valid: true, user: decoded };
}
export function requireRoles(request, roles) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!roles.includes(auth.user.role)) {
    return forbidden("Insufficient permissions");
  }
  if (!auth.user.societyId) {
    return forbidden("Society context required");
  }
  return auth;
}
export function requireSuperAdmin(request) {
  const token = request.cookies.get("admin_token")?.value;
  if (!token) return unauthorized();
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    console.error("ADMINJWTSECRET is not configured");
    return unauthorized("Admin auth is not configured");
  }
  try {
    const decoded = jwt.verify(token, secret);
    if (decoded.role !== "SuperAdmin") {
      return forbidden("Not authorized");
    }
    return { valid: true, admin: decoded };
  } catch {
    return unauthorized("Invalid token");
  }
}
// --- Visitor Management helpers ---
/**
 * Allows: Admin, Secretary, Security
 * Used in: /api/visitor/* routes
 */
export function requireVisitorAccess(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  const allowed = ["Admin", "Secretary", "Security"];
  if (!allowed.includes(auth.user.role))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/**
 * Security-role only gate.
 * Used for routes that only guards should call (log entry, scan pass).
 */
export function requireSecurity(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (auth.user.role !== "Security") return forbidden("Security role required");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/**
 * Accounting-module gate (Admin / Secretary / Accountant).
 * Used for routes under app/api/accounting/*.
 */
export function requireAccounting(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!ACCOUNTING_ROLES.includes(auth.user.role))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/**
 * Accounting-close gate (Admin / Secretary only) — Financial Year state
 * transitions, locking, approval. Narrower than requireAccounting: an
 * Accountant can record day-to-day entries but not close/lock a period.
 */
export function requireAccountingClose(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!ACCOUNTING_CLOSE_ROLES.includes(auth.user.role))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
