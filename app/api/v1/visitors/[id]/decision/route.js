import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { visitorDecisionSchema } from "@/lib/v1/schemas";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/:id/decision — resident (or admin/security) approves/denies
// a pending visitor. Stops escalation.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const body = await req.json().catch(() => ({}));
  const parsed = visitorDecisionSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const visitor = await Visitor.findOne({ _id: id, societyId });
  if (!visitor) throw new ApiError(404, "Visitor not found");
  const isPrivileged = VISITOR_ACCESS_ROLES.includes(claims.role);
  if (!isPrivileged && String(visitor.memberId) !== String(claims.memberId)) {
    throw new ApiError(403, "Not your visitor");
  }
  if (visitor.status !== "Pending") throw new ApiError(409, `Visitor already ${visitor.status}`);

  visitor.status = parsed.data.decision === "approve" ? "Approved" : "Rejected";
  visitor.approvedBy = claims.userId;
  visitor.approvedAt = new Date();
  visitor.approverRole = claims.role;
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
