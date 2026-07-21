import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { Member } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/visitors/flats/search?q= — guard looks up a flat/member to route a
// walk-in visitor to.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  const query = { societyId, isActive: { $ne: false } };
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ flatNo: rx }, { wing: rx }, { ownerName: rx }];
  }

  const members = await Member.find(query).select("flatNo wing ownerName").limit(25).lean();
  return json({
    flats: members.map((m) => ({
      memberId: String(m._id),
      flatNo: m.flatNo ?? null,
      wing: m.wing ?? null,
      ownerName: m.ownerName ?? null,
    })),
  });
});
