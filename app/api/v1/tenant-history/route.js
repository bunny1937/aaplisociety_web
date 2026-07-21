import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { tenantHistoryCreateSchema } from "@/lib/v1/schemas";
import { Member } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES, OCCUPANCY_TYPES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/tenant-history — returns the member's past tenancies (embedded on the
// Member doc). Admins may pass ?memberId=.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);

  let memberId = claims.memberId;
  if (SOCIETY_ADMIN_ROLES.includes(claims.role) && url.searchParams.get("memberId")) {
    memberId = url.searchParams.get("memberId");
  }
  if (!memberId) return json({ history: [] });

  const member = await Member.findOne({ _id: memberId, societyId }).select("tenantHistory").lean();
  return json({ history: member?.tenantHistory ?? [] });
});

// POST /v1/tenant-history — owner backfills a past tenancy record.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can add tenant history");
  if (claims.occupancyType === OCCUPANCY_TYPES.TENANT) throw new ApiError(403, "Only owners can add tenant history");
  const body = await req.json().catch(() => ({}));
  const parsed = tenantHistoryCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const entry = {
    tenantName: data.tenantName,
    tenantPhone: data.tenantPhone,
    tenantEmail: data.tenantEmail,
    leaseStartDate: new Date(data.startDate),
    leaseEndDate: new Date(data.endDate),
    rentPerMonth: data.rentPerMonth,
    depositAmount: data.depositAmount ?? 0,
    moveOutReason: data.moveOutReason,
    movedOutAt: new Date(data.endDate),
    backfilled: true,
  };
  const res = await Member.updateOne({ _id: claims.memberId, societyId }, { $push: { tenantHistory: entry } });
  if (!res.matchedCount) throw new ApiError(404, "Member not found");
  return json({ ok: true, entry }, { status: 201 });
});
