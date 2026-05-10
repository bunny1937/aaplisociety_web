// middleware.js
import { NextResponse } from "next/server";

export function middleware(request) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get("token")?.value;
  const adminToken = request.cookies.get("admin_token")?.value;

  function parseJwt(t) {
    try {
      const base64Url = t.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join(""),
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

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
      const adminPayload = parseJwt(adminToken);
      if (adminPayload?.role === "SuperAdmin") {
        return NextResponse.redirect(
          new URL("/superadmin/dashboard", request.url),
        );
      }
    }
    if (token) {
      const payload = parseJwt(token);
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
    const adminPayload = parseJwt(adminToken);
    if (!adminPayload || adminPayload.role !== "SuperAdmin") {
      return NextResponse.redirect(new URL("/superadmin/login", request.url));
    }
    return NextResponse.next();
  }

  // ── ADMIN + MEMBER PROTECTED ROUTES ──────────────────────────────────────
  if (!token) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  const payload = parseJwt(token);
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
  matcher: ["/", "/admin/:path*", "/member/:path*", "/superadmin/:path*"],
};
