import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/:id/enter — guard/admin records physical entry.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);

  const visitor = await Visitor.findOne({ _id: id, societyId });
  if (!visitor) throw new ApiError(404, "Visitor not found");
  if (visitor.status === "Entered") throw new ApiError(409, "Visitor already entered");
  if (visitor.status === "Rejected") throw new ApiError(409, "Visitor was rejected");

  visitor.status = "Entered";
  visitor.entryTime = new Date();
  visitor.enteredBy = claims.userId;
  visitor.escalation = { ...(visitor.escalation || {}), stopped: true };
  await visitor.save();

  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: visitor.memberId,
    status: visitor.status,
    entryMethod: visitor.entryMethod,
    isBlacklisted: visitor.isBlacklisted,
  });

  return json({ visitor });
});
