// middleware.js
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";


async function parseJwt(t, secretEnvKey = "JWT_SECRET") {
  try {
    const secret = new TextEncoder().encode(process.env[secretEnvKey]);
    const { payload } = await jwtVerify(t, secret);
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // API routes: only do CSRF check, then pass through — never redirect to login page
  if (pathname.startsWith("/api/")) {
    const isUnsafeMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isUnsafeMethod) {
      const origin = request.headers.get("origin");
      // Non-production only: allow Playwright APIRequestContext which sends no Origin.
      // Double-gated: NODE_ENV check ensures this path is dead in production even if
      // an attacker crafts x-test-mode header.
      const isTestBypass =
        process.env.NODE_ENV !== "production" &&
        request.headers.get("x-test-mode") === "true";
      if (!isTestBypass && (!origin || origin !== ALLOWED_ORIGIN)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;
  const adminToken = request.cookies.get("admin_token")?.value;

  // ── PUBLIC ROUTES ─────────────────────────────────────────────────────────
  const publicRoutes = [
    "/auth/login",
    "/auth/signup",
    "/admin/login",
    "/member/login",
    "/superadmin/login",
  ];
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // ── ROOT REDIRECT ─────────────────────────────────────────────────────────
  if (pathname === "/") {
    if (adminToken) {
      const adminPayload = await parseJwt(adminToken, "ADMIN_JWT_SECRET");
      if (adminPayload?.role === "SuperAdmin") {
        return NextResponse.redirect(
          new URL("/superadmin/dashboard", request.url),
        );
      }
    }
    if (token) {
      const payload = await parseJwt(token);
      if (
        payload?.role === "Admin" ||
        payload?.role === "Secretary" ||
        payload?.role === "Accountant"
      ) {
        return NextResponse.redirect(new URL("/admin/dashboard", request.url));
      }
      // Member token: new shape has activeProfileId, no role
      // Old shape: role === "Member"
      if (payload?.activeProfileId || payload?.role === "Member") {
        return NextResponse.redirect(new URL("/member/dashboard", request.url));
      }
    }
    return NextResponse.next();
  }

  // ── SUPERADMIN ROUTES ─────────────────────────────────────────────────────
  if (pathname.startsWith("/superadmin")) {
    if (!adminToken) {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
    const adminPayload = await parseJwt(adminToken, "ADMIN_JWT_SECRET");
    if (!adminPayload || adminPayload.role !== "SuperAdmin") {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
    return NextResponse.next();
  }

  // ── ADMIN + MEMBER PROTECTED ROUTES ──────────────────────────────────────
  if (!token) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const payload = await parseJwt(token);
  if (!payload) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  // Determine effective role:
  // - Admin/Secretary: payload.role present
  // - Member (new JWT): payload.activeProfileId present, no role
  // - Member (old JWT): payload.role === "Member"
  const isAdmin =
    payload.role === "Admin" ||
    payload.role === "Secretary" ||
    payload.role === "Accountant" ||
    payload.role === "SOCIETY_ADMIN";
  const isMember = payload.role === "Member" || !!payload.activeProfileId;

  // /admin exact → redirect to dashboard
  if (pathname === "/admin") {
    return NextResponse.redirect(new URL("/admin/dashboard", request.url));
  }

  if (pathname.startsWith("/admin") && !isAdmin) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  if (pathname.startsWith("/member") && !isMember) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/member/:path*",
    "/superadmin/:path*",
    "/api/:path*",
  ],
};
