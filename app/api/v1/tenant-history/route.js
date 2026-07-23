import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { tenantHistoryCreateSchema } from "@/lib/v1/schemas";
import { Member, TenantRequest } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES, OCCUPANCY_TYPES } from "@/lib/v1/constants";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dto = (t) => t ? ({
  _id: t._id ? String(t._id) : null,
  tenantName: t.tenantName ?? t.name ?? null,
  tenantPhone: t.tenantPhone ?? t.contactNumber ?? null,
  tenantEmail: t.tenantEmail ?? t.email ?? null,
  panCard: t.panCard ?? null,
  leaseStartDate: t.leaseStartDate ?? t.startDate ?? null,
  leaseEndDate: t.leaseEndDate ?? t.endDate ?? null,
  rentPerMonth: t.rentPerMonth ?? 0, depositAmount: t.depositAmount ?? 0,
  moveOutReason: t.moveOutReason ?? null, isCurrent: t.isCurrent === true,
}) : null;
export const GET = withRoute(async (req) => {
  const claims = getClaims(req); const societyId = requireTenant(claims); const url = new URL(req.url);
  let memberId = claims.memberId;
  if (SOCIETY_ADMIN_ROLES.includes(claims.role) && url.searchParams.get("memberId")) memberId = url.searchParams.get("memberId");
  if (!memberId) return json({ currentTenant: null, history: [], requests: [] });
  const [member, requests] = await Promise.all([
    Member.findOne({ _id: memberId, societyId }).select("currentTenant tenantHistory").lean(),
    TenantRequest.find({ memberId, societyId }).sort({ createdAt: -1 }).lean(),
  ]);
  return json({ currentTenant: dto(member?.currentTenant),
    history: (member?.tenantHistory || []).filter(t => !t.isCurrent).map(dto),
    requests: requests.map(r => ({ ...r, _id: String(r._id) })) });
});
export const POST = withRoute(async (req) => {
  const claims = getClaims(req); const societyId = requireTenant(claims);
  if (!claims.memberId || claims.occupancyType === OCCUPANCY_TYPES.TENANT) throw new ApiError(403, "Only owners can add past tenants");
  const parsed = tenantHistoryCreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw zodError(parsed); const d = parsed.data;
  const entry = { name:d.tenantName, contactNumber:d.tenantPhone, email:d.tenantEmail,
    startDate:new Date(d.startDate), endDate:new Date(d.endDate), rentPerMonth:d.rentPerMonth,
    depositAmount:d.depositAmount ?? 0, moveOutReason:d.moveOutReason, isCurrent:false };
  const result = await Member.updateOne({ _id: claims.memberId, societyId }, { $push: { tenantHistory: entry } });
  if (!result.matchedCount) throw new ApiError(404, "Member not found");
  return json({ ok:true, entry:dto(entry) }, { status:201 });
});
