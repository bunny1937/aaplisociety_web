import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { profileEditRequestCreateSchema } from "@/lib/v1/schemas";
import { ProfileEditRequest, Member } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/profile-edit-requests — admins see all pending edits; members see
// their own.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const query = { societyId };
  if (!SOCIETY_ADMIN_ROLES.includes(claims.role)) {
    if (!claims.memberId) return json({ requests: [] });
    query.memberId = claims.memberId;
  }
  const requests = await ProfileEditRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
  return json({ requests: requests.map((r) => ({ ...r, _id: String(r._id) })) });
});

// POST /v1/profile-edit-requests — a resident requests a change to their
// member profile (contact / emergency contact / family member); admins approve
// separately on the web.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can request profile edits");
  const body = await req.json().catch(() => ({}));
  const parsed = profileEditRequestCreateSchema.safeParse(body);
  if (!parsed.success) {
    // Verbose diagnostics: a 400 here must never again be a blind "Invalid
    // input". We echo exactly what the server received + which fields failed,
    // plus a _build stamp so we can confirm THIS code is actually deployed.
    const flat = parsed.error.flatten();
    console.error("[v1] profile-edit-requests validation failed", {
      received: body,
      issues: parsed.error.issues,
    });
    return json(
      {
        error: flat,
        _build: "2026-07-22-parking-diag-1",
        received: {
          section: body?.section ?? null,
          action: body?.action ?? null,
          payloadKeys: body?.payload ? Object.keys(body.payload) : null,
          payload: body?.payload ?? null,
        },
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const member = await Member.findOne({ _id: claims.memberId, societyId }).select("_id");
  if (!member) throw new ApiError(404, "Member not found");

  const request = await ProfileEditRequest.create({
    societyId,
    memberId: member._id,
    requestedByUserId: claims.userId,
    section: data.section,
    action: data.action,
    familyMemberId: data.familyMemberId,
    payload: data.payload ?? {},
    status: "Pending",
  });
  return json({ request: { ...request.toObject(), _id: String(request._id) } }, { status: 201 });
});