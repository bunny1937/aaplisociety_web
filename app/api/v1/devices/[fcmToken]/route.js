import { withRoute, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { DeviceToken } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /v1/devices/:fcmToken — deregister a device on logout. Scoped to the
// caller so a user can only remove their own tokens.
export const DELETE = withRoute(async (req, ctx) => {
  const { fcmToken } = await ctx.params;
  const claims = getClaims(req, { allowMustChange: true });
  await DeviceToken.deleteOne({ fcmToken: decodeURIComponent(fcmToken), userId: claims.userId });
  return json({ ok: true });
});
