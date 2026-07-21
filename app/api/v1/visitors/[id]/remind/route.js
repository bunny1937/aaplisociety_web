import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { Visitor, User } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH /v1/visitors/:id/remind — guard nudges the resident again for a
// pending visitor (re-sends the approval notification).
export const PATCH = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);

  const visitor = await Visitor.findOne({ _id: id, societyId });
  if (!visitor) throw new ApiError(404, "Visitor not found");
  if (visitor.status !== "Pending") throw new ApiError(409, `Visitor already ${visitor.status}`);

  visitor.escalation = { ...(visitor.escalation || {}), lastNotifiedAt: new Date() };
  await visitor.save();

  const guard = await User.findById(claims.userId).select("name username");
  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: visitor.memberId,
    status: visitor.status,
    entryMethod: visitor.entryMethod,
    isBlacklisted: visitor.isBlacklisted,
    guardId: claims.userId,
    guardName: guard?.name || guard?.username,
  });

  return json({ ok: true });
});
