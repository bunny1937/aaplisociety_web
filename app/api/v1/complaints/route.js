import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { complaintSchema } from "@/lib/v1/schemas";
import { Complaint } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { generateAnonymousName } from "@/lib/v1/anonymousName";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hide the real member behind the anonymous handle unless the viewer is an
// admin/secretary (parity with the web complaint board).
function present(c, claims) {
  const isAdmin = SOCIETY_ADMIN_ROLES.includes(claims.role);
  const own = String(c.memberId) === String(claims.memberId);
  return {
    _id: String(c._id),
    category: c.category,
    title: c.title,
    description: c.description,
    status: c.status,
    anonymous: c.anonymous,
    anonymousName: c.anonymousName,
    resolutionNote: c.resolutionNote ?? null,
    createdAt: c.createdAt,
    memberId: isAdmin || own ? String(c.memberId) : undefined,
  };
}

// GET /v1/complaints — admins see all society complaints; members see only
// their own.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const query = { societyId };
  if (!SOCIETY_ADMIN_ROLES.includes(claims.role)) {
    if (!claims.memberId) return json({ complaints: [] });
    query.memberId = claims.memberId;
  }
  const complaints = await Complaint.find(query).sort({ createdAt: -1 }).limit(200).lean();
  return json({ complaints: complaints.map((c) => present(c, claims)) });
});

// POST /v1/complaints — a resident files a complaint.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can file complaints");
  const body = await req.json().catch(() => ({}));
  const parsed = complaintSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const complaint = await Complaint.create({
    societyId,
    memberId: claims.memberId,
    anonymousName: generateAnonymousName(),
    category: data.category,
    title: data.title,
    description: data.description,
    anonymous: !!data.anonymous,
    status: "PENDING",
  });
  return json({ complaint: present(complaint, claims) }, { status: 201 });
});
