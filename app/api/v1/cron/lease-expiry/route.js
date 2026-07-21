import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import { TenantRequest, Notification } from "@/lib/v1/models";
import { NOTIFICATION_TYPES } from "@/lib/v1/constants";
import { sendFcmToMember } from "@/lib/v1/fcm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/cron/lease-expiry — runs daily (see vercel.json).
//
// Polling replacement for the BullMQ tenancy worker's checkLeaseExpiry. Finds
// Approved tenancies whose leaseEndDate has passed and that haven't been marked
// expired yet, stamps leaseExpiredAt (idempotency guard), and notifies the
// owner + admins to start the move-out confirmation flow.
export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const due = await TenantRequest.find({
    status: "Approved",
    leaseEndDate: { $lt: now },
    leaseExpiredAt: { $in: [null, undefined] },
  }).limit(500);

  let notified = 0;
  for (const r of due) {
    r.leaseExpiredAt = now;
    await r.save();

    await Notification.create({
      societyId: r.societyId,
      type: NOTIFICATION_TYPES.TENANT_LEASE_EXPIRED,
      title: "Tenant lease expired",
      message: `The lease for ${r.tenantName} has expired. Please confirm move-out.`,
      recipientType: "member",
      recipientIds: [String(r.memberId)],
      metadata: { tenantRequestId: String(r._id) },
    });
    await sendFcmToMember(
      String(r.memberId),
      { title: "Tenant lease expired", body: `The lease for ${r.tenantName} has expired. Please confirm move-out.` },
      { type: NOTIFICATION_TYPES.TENANT_LEASE_EXPIRED, tenantRequestId: String(r._id) },
    );
    notified += 1;
  }

  return json({ ok: true, expired: notified });
});
