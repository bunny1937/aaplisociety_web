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

// ---------------------------------------------------------------------------
// THE bug behind most of the owner-side tenancy complaints.
//
// `dto()` above is a whitelist, and it whitelists away every field the owner
// app's My Tenant screen actually drives its controls from:
//
//   * loginEnabled -> the "Tenant app login" switch read `tenancy.loginEnabled`,
//     got undefined, and therefore rendered OFF and grey forever. Toggling it
//     really did work server-side (PATCH .../login flips it), but the very next
//     refetch came back through this DTO with the flag stripped again, so the
//     switch snapped straight back to disabled. That is the exact "it says
//     enabled now but it still shows disabled" loop.
//   * documents -> missingDocs() saw no documents at all, so a tenant who had
//     uploaded one was still reported as missing it, and there was nothing to
//     open.
//   * noteThread -> the owner could never read the note their tenant sent, even
//     though they got the push for it.
//   * _id / status -> member.currentTenant is an embedded subdocument with no
//     TenantRequest id, so every action that needs a request id (login toggle,
//     documents, notes) had nothing to address.
//
// The embedded snapshot stays the source of truth for the lease TERMS; the
// matching TenantRequest supplies the live operational state.
const ACTIVE_STATUSES = ["Approved", "Active"];

function activeRequestFor(currentTenant, requests) {
  if (!currentTenant || !Array.isArray(requests) || !requests.length) return null;
  const phone = currentTenant.tenantPhone ?? currentTenant.contactNumber ?? null;
  const email = currentTenant.tenantEmail ?? currentTenant.email ?? null;
  const matches = requests.filter((r) => {
    if (!ACTIVE_STATUSES.includes(r.status)) return false;
    if (r.endedAt) return false;
    // Match on whichever identifier the tenancy actually carries. A flat can
    // have had several TenantRequests over the years; only the live one counts.
    if (phone && r.tenantPhone && String(r.tenantPhone) === String(phone)) return true;
    if (email && r.tenantEmail && String(r.tenantEmail) === String(email)) return true;
    return false;
  });
  // requests already arrive sorted newest-first.
  if (matches.length) return matches[0];
  // Fall back to the single live request on the flat, if there is exactly one.
  const live = requests.filter((r) => ACTIVE_STATUSES.includes(r.status) && !r.endedAt);
  return live.length === 1 ? live[0] : null;
}

function withLiveState(currentTenant, requests) {
  const base = dto(currentTenant);
  if (!base) return null;
  const req = activeRequestFor(currentTenant, requests);
  if (!req) return { ...base, documents: {}, noteThread: [], loginEnabled: null, status: null };
  return {
    ...base,
    // The id every owner-side action needs.
    _id: String(req._id),
    status: req.status ?? null,
    // `loginEnabled` is only mirrored onto the request from the day the login
    // route first ran. For a tenancy approved before that, absence does NOT
    // mean "disabled" - an approved tenancy has a working login by definition.
    // Reporting null lets the app show the true default instead of a wrong OFF.
    loginEnabled: typeof req.loginEnabled === "boolean" ? req.loginEnabled : null,
    documents: req.documents ?? {},
    noteThread: Array.isArray(req.noteThread) ? req.noteThread : [],
    ownerName: req.ownerName ?? base.ownerName ?? null,
    ownerPhone: req.ownerPhone ?? base.ownerPhone ?? null,
  };
}
export const GET = withRoute(async (req) => {
  const claims = getClaims(req); const societyId = requireTenant(claims); const url = new URL(req.url);
  let memberId = claims.memberId;
  if (SOCIETY_ADMIN_ROLES.includes(claims.role) && url.searchParams.get("memberId")) memberId = url.searchParams.get("memberId");
  if (!memberId) return json({ currentTenant: null, history: [], requests: [] });
  const [member, requests] = await Promise.all([
    Member.findOne({ _id: memberId, societyId }).select("currentTenant tenantHistory").lean(),
    TenantRequest.find({ memberId, societyId }).sort({ createdAt: -1 }).lean(),
  ]);
  return json({ currentTenant: withLiveState(member?.currentTenant, requests),
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
