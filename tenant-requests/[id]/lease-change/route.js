import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, Member } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only the flat's owner may drive these lifecycle actions.
async function ownerRequest(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (claims.occupancyType === "Tenant") throw new ApiError(403, "Only the owner can manage the tenancy");
  const request = await TenantRequest.findOne({ _id: id, societyId });
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return { claims, societyId, request };
}

// POST /v1/tenant-requests/:id/lease-change - owner proposes new lease dates.
// Stored as a pending change the admin approves; live dates are untouched.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await ownerRequest(req, id);
  const body = await req.json().catch(() => ({}));
  if (!body.leaseStartDate && !body.leaseEndDate) throw new ApiError(400, "Provide leaseStartDate and/or leaseEndDate");
  request.pendingLeaseChange = {
    leaseStartDate: body.leaseStartDate ? new Date(body.leaseStartDate) : undefined,
    leaseEndDate: body.leaseEndDate ? new Date(body.leaseEndDate) : undefined,
    requestedAt: new Date(),
    status: "Pending",
  };
  await request.save();
  return json({
    tenantRequest: { ...request.toObject(), _id: String(request._id) },
    message: "Lease date change submitted for admin approval",
  });
});
