import { withRoute, json, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { deviceRegisterSchema } from "@/lib/v1/schemas";
import { DeviceToken } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/devices — register/refresh this device's FCM token. Upsert by token
// so a device that switches accounts is re-pointed to the new user.
export const POST = withRoute(async (req) => {
  if (process.env.NODE_ENV !== "production") console.log("[v1/devices] POST hit");
  const claims = getClaims(req, { allowMustChange: true });
  const body = await req.json().catch(() => ({}));
  const parsed = deviceRegisterSchema.safeParse(body);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") console.log("[v1/devices] validation failed:", parsed.error.flatten());
    throw zodError(parsed);
  }
  const { fcmToken, platform } = parsed.data;

  await DeviceToken.findOneAndUpdate(
    { fcmToken },
    {
      $set: {
        userId: claims.userId,
        societyId: claims.societyId,
        platform,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
  if (process.env.NODE_ENV !== "production") {
    console.log(`[v1/devices] registered token for user=${claims.userId}, society=${claims.societyId}, platform=${platform}`);
  }
  return json({ ok: true });
});
