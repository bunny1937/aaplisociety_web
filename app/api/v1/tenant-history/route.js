import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { tenantHistoryCreateSchema } from "@/lib/v1/schemas";
import { Member, TenantRequest, User } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES, OCCUPANCY_TYPES } from "@/lib/v1/constants";
import { resolveLoginEnabledMany } from "@/lib/v1/tenancyState";

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
// The embedded Member.currentTenant snapshot is the source of truth for the
// lease TERMS; the matching TenantRequest supplies the live operational state.
//
// WHAT CHANGED IN THIS PASS
//
// `loginEnabled` used to be reported as `null` whenever the TenantRequest had
// no mirrored boolean:
//
//     loginEnabled: typeof req.loginEnabled === "boolean" ? req.loginEnabled : null
//
// The intent was "unknown, let the app decide", but the app's resolver then
// fell through a chain that ends at the tenancy status, and for a tenancy
// whose status string is anything other than a literal "approved"/"active" it
// lands on FALSE. Result: an owner staring at a greyed-out switch for a tenant
// who has been logging in for weeks, and being invited to "enable" a login that
// was never disabled.
//
// null was never a good answer. The real answer is one query away, on the flag
// the auth layer actually enforces: User.isActive. resolveLoginEnabledMany()
// answers it for every tenancy in ONE batched users query.
//
// `ownerName`/`ownerPhone` are also filled from the owner's Member row now.
// They were read off the TenantRequest, where they have never been written,
// which is why the tenant app's Flat owner card said "No number on record".
// ---------------------------------------------------------------------------
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

function withLiveState(currentTenant, requests, loginMap, owner) {
  const base = dto(currentTenant);
  if (!base) return null;

  // The landlord's real name and number, from the members collection.
  const ownerName = owner?.ownerName ?? null;
  const ownerPhone =
    owner?.contactNumber || owner?.whatsappNumber || owner?.alternateContact || null;

  const req = activeRequestFor(currentTenant, requests);
  if (!req) {
    return {
      ...base,
      documents: {},
      noteThread: [],
      unreadFromTenant: 0,
      loginEnabled: false,
      status: null,
      ownerName,
      ownerPhone,
    };
  }
  return {
    ...base,
    // The id every owner-side action needs.
    _id: String(req._id),
    status: req.status ?? null,
    // A real boolean, resolved from the tenant User's isActive. Never null.
    loginEnabled: loginMap.get(String(req._id)) ?? false,
    // Now includes the *Review verdicts, which Mongoose used to silently drop
    // on write because they were not declared on the documents sub-schema.
    documents: req.documents ?? {},
    noteThread: Array.isArray(req.noteThread) ? req.noteThread : [],
    // Unread count for the owner, so the Messages chip can carry a badge
    // instead of the owner having to open the thread to discover a new note.
    unreadFromTenant: Array.isArray(req.noteThread)
      ? req.noteThread.filter((n) => n?.by === "Tenant").length
      : 0,
    ownerName: req.ownerName || ownerName,
    ownerPhone: req.ownerPhone || ownerPhone,
  };
}

export const GET = withRoute(async (req) => {
  const claims = getClaims(req); const societyId = requireTenant(claims); const url = new URL(req.url);
  let memberId = claims.memberId;
  if (SOCIETY_ADMIN_ROLES.includes(claims.role) && url.searchParams.get("memberId")) memberId = url.searchParams.get("memberId");
  if (!memberId) return json({ currentTenant: null, history: [], requests: [] });

  const [member, requests] = await Promise.all([
    Member.findOne({ _id: memberId, societyId })
      .select("currentTenant tenantHistory ownerName contactNumber alternateContact whatsappNumber")
      .lean(),
    TenantRequest.find({ memberId, societyId }).sort({ createdAt: -1 }).lean(),
  ]);

  // ONE users query for every tenancy on this flat, not one per tenancy.
  const loginMap = await resolveLoginEnabledMany(requests, { User });

  return json({
    currentTenant: withLiveState(member?.currentTenant, requests, loginMap, member),
    history: (member?.tenantHistory || []).filter(t => !t.isCurrent).map(dto),
    requests: requests.map(r => ({
      ...r,
      _id: String(r._id),
      loginEnabled: loginMap.get(String(r._id)) ?? false,
      documents: r.documents ?? {},
      noteThread: Array.isArray(r.noteThread) ? r.noteThread : [],
    })),
  });
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
