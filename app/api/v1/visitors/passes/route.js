import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { VisitorPass } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/visitors/passes — resident lists their own passes (admins/security
// may list all society passes).
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const query = { societyId };
  if (!VISITOR_ACCESS_ROLES.includes(claims.role)) query.memberId = claims.memberId;
  if (status) query.status = status;

  const passes = await VisitorPass.find(query).sort({ createdAt: -1 }).limit(100).select("-otpHash -qrTokenHash").lean();
  return json({ passes });
});
