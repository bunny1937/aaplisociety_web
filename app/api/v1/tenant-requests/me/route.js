import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { TenantRequest, Member, User } from "@/lib/v1/models";
import { resolveLoginEnabled } from "@/lib/v1/tenancyState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/tenant-requests/me - the caller's own current tenancy (owner or
// tenant side of the same flat), returning the real TenantRequest doc.
//
// WHAT CHANGED
//
// 1. ownerName / ownerPhone are now resolved from the owner's Member row.
//    tenant_profile_page.dart lines 369-372 read:
//        tenancy?['ownerName'] ?? member['name']
//        tenancy?['ownerPhone'] ?? member['phone']
//    Neither key existed on the raw TenantRequest document, and on the tenant
//    side `member` is the TENANT's own view, which carries no landlord phone.
//    Both fell through to null, which is why the Flat owner card rendered
//    "No number on record - ask the society office" for a landlord whose name
//    and number have been sitting in the members collection the whole time.
//    The record was there. Nothing was reading it.
//
// 2. loginEnabled is resolved from the tenant User's actual isActive flag
//    rather than a mirrored boolean that only exists after somebody has
//    toggled the switch once. See lib/v1/tenancyState.js.
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

  const [owner, loginEnabled] = await Promise.all([
    Member.findOne({ _id: request.memberId, societyId })
      .select("ownerName contactNumber alternateContact whatsappNumber emailPrimary flatNo wing")
      .lean(),
    resolveLoginEnabled(request, { User }),
  ]);

  return json({
    tenancy: {
      ...request,
      _id: String(request._id),
      loginEnabled,
      ownerName: request.ownerName || owner?.ownerName || null,
      ownerPhone:
        request.ownerPhone ||
        owner?.contactNumber ||
        owner?.whatsappNumber ||
        owner?.alternateContact ||
        null,
      ownerEmail: owner?.emailPrimary || null,
      flatNo: owner?.flatNo ?? null,
      wing: owner?.wing ?? null,
      // Guaranteed shapes, so the app never has to null-guard these.
      documents: request.documents || {},
      noteThread: Array.isArray(request.noteThread) ? request.noteThread : [],
    },
  });
});
