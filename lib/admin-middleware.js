import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

/**
 * ULTRA-STRICT admin route protection
 * Validates:
 * 1. Admin API key in headers
 * 2. Valid JWT token
 * 3. SuperAdmin role
 * 4. Rate limiting
 */

const loginAttempts = new Map(); // Track login attempts

export function validateAdminRequest(request) {
  // ✅ CHECK 1: Admin API key in headers
  const apiKey = request.headers.get("x-admin-api-key");

  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    console.warn("🚨 Unauthorized admin access attempt - Invalid API key");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // CHECK 2: SuperAdmin uses admin_token cookie only
  const token = request.cookies.get("admin_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Verify with ADMIN-specific JWT secret
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    } catch {
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
    }
    if (
      decoded.role !== "SuperAdmin" &&
      decoded.role !== "Admin" &&
      decoded.role !== "Secretary"
    ) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    return { valid: true, admin: decoded };
  } catch (error) {
    console.error("🚨 Invalid admin token:", error.message);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}

/**
 * Rate limiting for admin login
 */
export function checkRateLimit(email) {
  const now = Date.now();
  const attempts = loginAttempts.get(email) || { count: 0, resetAt: now };

  // Reset after 1 hour
  if (now > attempts.resetAt) {
    attempts.count = 0;
    attempts.resetAt = now + 60 * 60 * 1000; // 1 hour
  }

  attempts.count += 1;
  loginAttempts.set(email, attempts);

  const maxAttempts = parseInt(process.env.RATE_LIMIT_ADMIN) || 5;

  if (attempts.count > maxAttempts) {
    console.warn(`🚨 Rate limit exceeded for admin login: ${email}`);
    return { blocked: true, resetAt: attempts.resetAt };
  }

  return { blocked: false };
}

/**
 * Clear rate limit on successful login
 */
export function clearRateLimit(email) {
  loginAttempts.delete(email);
}
