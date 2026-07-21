import { withRoute } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { User } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { json } from "@/lib/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/security/guards — other guards on duty at this society, for the
// guard-to-guard coordination screen (reassigning a pending visitor, pinging
// a colleague about an approval). Excludes the caller themself.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);

  const guards = await User.find({
    societyId,
    role: "Security",
    isActive: { $ne: false },
    _id: { $ne: claims.userId },
  })
    .select("name username gateLabel phone")
    .sort({ name: 1 })
    .lean();

  return json({
    guards: guards.map((g) => ({
      _id: String(g._id),
      name: g.name || g.username,
      gateLabel: g.gateLabel || "",
      phone: g.phone || "",
    })),
  });
});
