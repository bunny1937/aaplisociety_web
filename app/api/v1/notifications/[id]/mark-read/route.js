import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Notification } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/notifications/:id/mark-read — idempotently add the caller to readBy.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  await Notification.updateOne(
    { _id: id, societyId, "readBy.userId": { $ne: claims.userId } },
    { $push: { readBy: { userId: claims.userId, readAt: new Date() } } },
  );
  return json({ ok: true });
});
