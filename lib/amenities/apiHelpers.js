import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { requireAuth } from "@/lib/authz";
import { can, CAPABILITY } from "./permissions";

// Shared plumbing for the /api/amenities/* (website) routes.
//
// The repo has two auth layers — cookie JWT for the website (lib/authz) and
// bearer JWT for mobile (lib/v1/auth). Both produce a claims object with
// { userId, role, societyId }, so the amenity routes only need one adapter:
// resolve claims, then check a *capability* rather than re-listing roles in
// every file. That way the permission matrix has exactly one implementation.

export { CAPABILITY };

export function ok(data, init = {}) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function created(data) {
  return NextResponse.json(data, { status: 201 });
}

export function fail(status, message, extra = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function zodFail(parsed) {
  const first = parsed.error?.issues?.[0];
  return NextResponse.json(
    {
      error: first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request",
      issues: parsed.error?.issues || [],
    },
    { status: 422 },
  );
}

export function isId(v) {
  return typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
}

export function toId(v) {
  return new mongoose.Types.ObjectId(String(v));
}

/**
 * Gate a website amenity route on a capability.
 *
 * @returns { ok: true, user, societyId, actor } or { ok: false, response }
 */
export function gate(request, capability) {
  const auth = requireAuth(request);
  // requireAuth returns a NextResponse on failure (repo convention), so the
  // absence of `valid` is the failure signal.
  if (!auth?.valid) return { ok: false, response: auth };

  const user = auth.user;
  if (!user.societyId) {
    return { ok: false, response: fail(403, "Society context required") };
  }
  if (capability && !can(user.role, capability)) {
    return { ok: false, response: fail(403, "Insufficient permissions for this action") };
  }

  return {
    ok: true,
    user,
    societyId: user.societyId,
    actor: actorFrom(request, user),
  };
}

// Shape the activity log and notification helpers expect.
export function actorFrom(request, user) {
  return {
    userId: user?.userId || user?.id || user?._id || null,
    name: user?.name || user?.fullName || "",
    role: user?.role || "",
    ip: clientIpOf(request),
    userAgent: request?.headers?.get?.("user-agent") || null,
  };
}

export function clientIpOf(request) {
  const h = request?.headers;
  if (!h?.get) return null;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return h.get("x-real-ip") || null;
}

// Consistent list pagination across every amenity list endpoint.
export function paging(searchParams, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get("limit")) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

export function pageMeta({ page, limit, total }) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}

// Date range from query params, defaulting to the last 30 days. Every analytics
// and history endpoint uses this so "?from=&to=" behaves identically everywhere.
export function dateRange(searchParams, { defaultDays = 30 } = {}) {
  const toRaw = searchParams.get("to");
  const fromRaw = searchParams.get("from");
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - defaultDays * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from > to) return null;
  return { from, to };
}

// Turns service-layer error codes into HTTP statuses in one place, so a new
// error code does not need a new branch in every route. Exported so routes
// outside the apiHelpers/serviceError framework (e.g. the /v1 mobile routes,
// which use lib/v1/http's ApiError instead) can map the same codes.
export const STATUS_BY_CODE = {
  ALREADY_CHECKED_IN: 409,
  NOT_CHECKED_IN: 409,
  CAPACITY_FULL: 409,
  EVENT_FULL: 409,
  ALREADY_REGISTERED: 409,
  NOT_REGISTERED: 404,
  NOT_QUEUED: 404,
  WAITLIST_DISABLED: 409,
  EVENT_CANCELLED: 409,
  EVENT_NOT_OPEN: 409,
  EVENT_STARTED: 409,
  REGISTRATION_CLOSED: 409,
  NO_REGISTRATION: 400,
  GUESTS_NOT_ALLOWED: 400,
  GUEST_LIMIT: 400,
  AMENITY_CLOSED: 409,
  OUTSIDE_HOURS: 409,
  NOT_ELIGIBLE: 403,
  EXPIRED: 410,
  INVALID_TOKEN: 400,
  REVOKED: 410,
};

export function serviceError(err) {
  if (err?.code && STATUS_BY_CODE[err.code]) {
    return NextResponse.json(
      { error: err.message, code: err.code, ...(err.meta || {}) },
      { status: STATUS_BY_CODE[err.code] },
    );
  }
  if (err?.code === 11000) {
    return fail(409, "That record already exists");
  }
  console.error("[amenities/api]", err?.message || err, err?.stack);
  return fail(500, "Something went wrong. Please try again.");
}

// Wraps a handler so no route has to repeat try/catch + DB connect.
export function withAmenityRoute(handler) {
  return async (request, ctx) => {
    try {
      const { default: connectDB } = await import("@/lib/mongodb");
      await connectDB();
      return await handler(request, ctx);
    } catch (err) {
      return serviceError(err);
    }
  };
}
