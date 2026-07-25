import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { notifyRentReminder } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/rent-payments/remind - owner nudges the tenant (push + in-app).
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (claims.occupancyType === "Tenant") throw new ApiError(403, "Only the owner can send rent reminders");
  if (!claims.memberId) throw new ApiError(403, "No flat linked to this account");
  const body = await req.json().catch(() => ({}));
  await notifyRentReminder({
    societyId,
    memberId: claims.memberId,
    month: body.month || "this month",
    amount: body.amount ?? 0,
  });
  return json({ success: true, message: "Reminder sent to your tenant" });
});
