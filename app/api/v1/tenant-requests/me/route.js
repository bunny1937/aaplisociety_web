import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/tenant-requests/me — the caller's own current tenancy (owner or
// tenant side of the same flat), returning the real TenantRequest doc.
//
// Without this route, the app fell back to /tenant-history and used
// Member.currentTenant._id as the tenancy id — a different document
// entirely — which is why every action built on top of it (login toggle,
// notes, document attach, end-lease) 404'd with "Tenant request not found".
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) return json({ tenancy: null });
  const request = await TenantRequest.findOne({
    memberId: claims.memberId,
    societyId,
    status: "Approved",
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!request) return json({ tenancy: null });
  return json({ tenancy: { ...request, _id: String(request._id) } });
});
