import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, Member } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Either the flat's owner OR the approved tenant may attach a document here —
// the tenant-side "My Documents" upload flow reuses this same route to attach
// its own post-approval documents (see tenant_profile_page.dart's
// `_uploadDoc`), so an owner-only guard 403'd every tenant self-upload.
async function tenancyForCaller(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can manage tenancy documents");
  const request = await TenantRequest.findOne({ _id: id, societyId });
  if (!request) throw new ApiError(404, "Tenant request not found");
  if (String(request.memberId) !== String(claims.memberId)) throw new ApiError(403, "Not your tenancy");
  return { claims, societyId, request };
}

const FIELD_MAP = {
  contract: "contractKey",
  signature: "signatureKey",
  aadhaar: "aadhaarKey",
  policeVerification: "policeVerificationKey",
};

// POST /v1/tenant-requests/:id/documents - owner attaches a document that was
// missing at onboarding (key comes from /tenant-requests/upload/:field).
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const { request } = await tenancyForCaller(req, id);
  const body = await req.json().catch(() => ({}));
  const key = FIELD_MAP[body.field];
  if (!key) throw new ApiError(400, `Unknown document field: ${body.field}`);
  if (!body.key) throw new ApiError(400, "Missing uploaded object key");
  const existing = request.documents?.toObject?.() ?? request.documents ?? {};
  request.documents = { ...existing, [key]: body.key };
  await request.save();
  return json({ documents: request.documents, message: "Document attached" });
});
