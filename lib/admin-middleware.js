import { requireSuperAdmin } from "./authz";
const loginAttempts = new Map();
export function validateAdminRequest(request) {
  return requireSuperAdmin(request);
}
export function checkRateLimit(email) {
  const key = String(email || "").trim().toLowerCase();
  const now = Date.now();
  const attempts = loginAttempts.get(key) || { count: 0, resetAt: now + 60 * 60 * 1000 };
  if (now > attempts.resetAt) {
    attempts.count = 0;
    attempts.resetAt = now + 60 * 60 * 1000;
  }
  attempts.count += 1;
  loginAttempts.set(key, attempts);
  const maxAttempts = parseInt(process.env.RATE_LIMIT_ADMIN, 10) || 5;
  if (attempts.count > maxAttempts) {
    console.warn(`Rate limit exceeded for admin login: ${key}`);
    return { blocked: true, resetAt: attempts.resetAt };
  }
  return { blocked: false };
}
export function clearRateLimit(email) {
  loginAttempts.delete(String(email || "").trim().toLowerCase());
}
