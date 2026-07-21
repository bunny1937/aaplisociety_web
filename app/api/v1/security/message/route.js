import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { User } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyGuardMessage } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/security/message — one guard pings another about a pending
// approval or general gate coordination. { toGuardId, message, visitorId? }
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const toGuardId = String(body.toGuardId || "").trim();
  const message = String(body.message || "").trim();
  if (!toGuardId) throw new ApiError(400, "toGuardId required");
  if (!message) throw new ApiError(400, "Message can't be empty");
  if (message.length > 500) throw new ApiError(400, "Message too long");

  const toGuard = await User.findOne({ _id: toGuardId, societyId, role: "Security" }).select("_id");
  if (!toGuard) throw new ApiError(404, "Guard not found");

  const me = await User.findById(claims.userId).select("name username");
  const fromGuardName = me?.name || me?.username || "A guard";

  await notifyGuardMessage({
    societyId,
    fromGuardId: claims.userId,
    fromGuardName,
    toGuardId,
    message,
    visitorId: body.visitorId,
  });

  return json({ ok: true });
});
