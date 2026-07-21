import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { User, Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorReassigned } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/:id/reassign — hand off a pending visitor to another
// guard (shift change, or the assigned guard is busy elsewhere at the gate).
// { toGuardId }
export const PATCH = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const toGuardId = String(body.toGuardId || "").trim();
  if (!toGuardId) throw new ApiError(400, "toGuardId required");

  const [visitor, toGuard, me] = await Promise.all([
    Visitor.findOne({ _id: id, societyId }),
    User.findOne({ _id: toGuardId, societyId, role: "Security" }).select("_id"),
    User.findById(claims.userId).select("name username"),
  ]);
  if (!visitor) throw new ApiError(404, "Visitor not found");
  if (!toGuard) throw new ApiError(404, "Guard not found");
  if (visitor.status !== "Pending") throw new ApiError(409, `Visitor already ${visitor.status}`);

  visitor.assignedGuardId = toGuardId;
  await visitor.save();

  await notifyVisitorReassigned({
    societyId,
    visitorId: visitor._id,
    visitorName: visitor.name,
    fromGuardName: me?.name || me?.username || "A guard",
    toGuardId,
  });

  return json({ ok: true, visitor });
});
