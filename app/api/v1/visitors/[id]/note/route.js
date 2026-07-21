import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Visitor, Member } from "@/lib/v1/models";
import { notifyGuardMessage } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/:id/note — a resident sends a text note to the guard
// handling their visitor's approval (e.g. "give me 5 minutes"). Reuses the
// guard-message notification pipeline; the recipient is whichever guard is
// currently on the entry (assignedGuardId, falling back to whoever logged it).
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can message the gate");
  const body = await req.json().catch(() => ({}));
  const message = String(body.message || "").trim();
  if (!message) throw new ApiError(400, "Message can't be empty");
  if (message.length > 500) throw new ApiError(400, "Message too long");

  const [visitor, member] = await Promise.all([
    Visitor.findOne({ _id: id, societyId, memberId: claims.memberId }),
    Member.findById(claims.memberId).select("ownerName flatNo wing"),
  ]);
  if (!visitor) throw new ApiError(404, "Visitor not found");
  const toGuardId = visitor.assignedGuardId || visitor.enteredBy;
  if (!toGuardId) throw new ApiError(409, "No guard is assigned to this visitor");

  const flatLabel = member ? `${member.wing || ""} ${member.flatNo || ""}`.trim() : "";
  const fromGuardName = member?.ownerName
    ? `${member.ownerName}${flatLabel ? ` (${flatLabel})` : ""}`
    : "Resident";

  await notifyGuardMessage({
    societyId,
    fromGuardId: claims.userId,
    fromGuardName,
    toGuardId,
    message,
    visitorId: visitor._id,
  });

  return json({ ok: true });
});
