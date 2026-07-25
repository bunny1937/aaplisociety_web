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

// POST /v1/tenant-requests/:id/notes - owner adds a note to the tenancy.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await ownerRequest(req, id);
  const body = await req.json().catch(() => ({}));
  const text = (body.note || "").trim();
  if (!text) throw new ApiError(400, "Note cannot be empty");
  request.notes = [...(request.notes || []), { text, at: new Date(), by: "Owner" }];
  await request.save();
  return json({ notes: request.notes });
});
