// PATCH /v1/tenant-requests/:id/login
//
// This route DID NOT EXIST, which is the entire reason the owner app's
// "Tenant app login" toggle returned 404 -> "something went wrong". The Flutter
// side (tenant_api.dart updateTenantLogin) was written against an endpoint that
// was never implemented on the backend. Nothing was wrong with the request.
//
// Enabling/disabling the login flips `isActive` on the tenant's User document
// (created by the admin approve route) and mirrors the flag onto the
// TenantRequest so GET /v1/tenant-requests can report it without a join.
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, User } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the flat's owner may drive these lifecycle actions. Same guard the
// sibling end-lease / lease-change / notes routes use.
async function ownerRequest(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (claims.occupancyType === "Tenant") throw new ApiError(403, "Only the owner can manage the tenancy");
  const request = await TenantRequest.findOne({ _id: id, societyId });
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return { claims, societyId, request };
}

// The tenant's User is linked to the flat through profiles[] (that is what the
// admin approve route writes), so match BOTH the profile shape and the legacy
// top-level memberId. Email/phone are the tie-breakers when a flat has had more
// than one tenant User over time.
async function findTenantUser(request) {
  const or = [];
  if (request.tenantEmail) or.push({ email: request.tenantEmail });
  if (request.tenantPhone) or.push({ phone: request.tenantPhone });
  if (!or.length) return null;
  return User.findOne({
    $and: [
      { $or: or },
      { $or: [{ memberId: request.memberId }, { "profiles.memberId": request.memberId }] },
    ],
  });
}

export const PATCH = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await ownerRequest(req, id);

  const body = await req.json().catch(() => ({}));
  if (typeof body.loginEnabled !== "boolean") {
    throw new ApiError(400, "loginEnabled must be true or false");
  }
  const enabled = body.loginEnabled;

  // A login only exists once the admin has approved the request and created the
  // tenant User. Before that there is nothing to enable, and silently returning
  // ok would leave the owner staring at a toggle that does nothing.
  if (request.status !== "Approved") {
    throw new ApiError(409, "The society admin has not approved this tenancy yet, so there is no login to change");
  }

  const tenantUser = await findTenantUser(request);
  if (!tenantUser) {
    throw new ApiError(404, "No tenant login found for this tenancy. Ask the society admin to re-issue it.");
  }

  tenantUser.isActive = enabled;
  await tenantUser.save();

  request.loginEnabled = enabled;
  request.notes = [
    ...(request.notes || []),
    { text: enabled ? "Tenant login enabled by owner" : "Tenant login disabled by owner", at: new Date(), by: "Owner" },
  ];
  await request.save();

  return json({
    ok: true,
    loginEnabled: enabled,
    tenantRequest: { ...request.toObject(), _id: String(request._id) },
    message: enabled ? "Tenant login enabled" : "Tenant login disabled",
  });
});
