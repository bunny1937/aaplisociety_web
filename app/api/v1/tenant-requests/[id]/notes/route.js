import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest } from "@/lib/v1/models";
import { notifyTenancyNote } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Tenancy note thread.
//
// This route used to be owner-only (`ownerRequest()` threw 403 for any caller
// with occupancyType === "Tenant") and it wrote an ARRAY onto
// TenantRequestSchema.notes, which is declared `notes: String`. The schema is
// strict:false so the write survived, but the field is not a real array path,
// so nothing could reliably read it back and the tenant could never see or add
// anything. That is why the app had no way for a tenant to reach their owner.
//
// The thread now lives on its own `noteThread[]` field and BOTH sides of the
// lease may read and post. The legacy `notes` string is still returned so any
// note written by the old owner-only route is not lost.
// ---------------------------------------------------------------------------

// Either party on the tenancy may use this route. Both an owner and their
// tenant carry the same flat memberId in their claims (the tenant's comes from
// the active profile), so one ownership check covers both; occupancyType is
// what tells us which side is speaking.
async function tenancyForCaller(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can use tenancy notes");
  const request = await TenantRequest.findOne({ _id: id, societyId }).lean();
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return { claims, societyId, request, isTenant: claims.occupancyType === "Tenant" };
}

function threadOf(request) {
  const thread = Array.isArray(request.noteThread) ? request.noteThread : [];
  return thread
    .map((n) => ({ text: n.text, at: n.at, by: n.by || "Owner" }))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

// GET /v1/tenant-requests/:id/notes - the shared thread, oldest first.
export const GET = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await tenancyForCaller(req, id);
  return json({
    notes: threadOf(request),
    legacyNote: typeof request.notes === "string" ? request.notes : "",
  });
});

// POST /v1/tenant-requests/:id/notes - owner OR tenant posts a message. The
// other side gets a push; the note itself IS the notification, so there is no
// separate "notify" endpoint to keep in sync.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { societyId, request, isTenant } = await tenancyForCaller(req, id);
  const body = await req.json().catch(() => ({}));
  const text = String(body.note || "").trim();
  if (!text) throw new ApiError(400, "Note cannot be empty");
  if (text.length > 1000) throw new ApiError(400, "Note is too long (1000 characters max)");

  // Targeted $push, not request.save() — a full-document .save() on an older
  // TenantRequest re-validates every field on the document and can 500 on
  // something unrelated to the note being posted (see documents/route.js).
  const entry = { text, at: new Date(), by: isTenant ? "Tenant" : "Owner" };
  await TenantRequest.updateOne({ _id: request._id }, { $push: { noteThread: entry } });
  const updated = await TenantRequest.findById(request._id).select("noteThread").lean();
  request.noteThread = updated?.noteThread || [];

  await notifyTenancyNote({
    societyId,
    memberId: request.memberId,
    requestId: request._id,
    text,
    fromTenant: isTenant,
  });

  return json({ notes: threadOf(request) }, { status: 201 });
});
