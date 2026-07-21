import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getTokenFromRequest, verifyToken } from "./jwt";
export const SOCIETY_ADMIN_ROLES = ["Admin", "Secretary"];
export const BILLING_WRITE_ROLES = ["Admin", "Secretary"];
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
