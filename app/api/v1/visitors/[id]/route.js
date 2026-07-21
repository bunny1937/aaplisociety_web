import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /v1/visitors/:id — guard/admin permanently removes a logged entry
// (e.g. a mis-typed or duplicate walk-in). Unlike deny/exit this doesn't just
// change status — the row is gone.
export const DELETE = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);

  const result = await Visitor.deleteOne({ _id: id, societyId });
  if (result.deletedCount === 0) throw new ApiError(404, "Visitor not found");

  return json({ ok: true });
});
