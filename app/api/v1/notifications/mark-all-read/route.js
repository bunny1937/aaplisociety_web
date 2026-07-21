import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Notification } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/notifications/mark-all-read — mark every notification currently
// visible to the caller as read.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);

  const base = { societyId, isDeleted: { $ne: true }, "readBy.userId": { $ne: claims.userId } };
  let query;
  if (VISITOR_ACCESS_ROLES.includes(claims.role)) {
    query = base;
  } else {
    const or = [{ recipientType: "all" }];
    if (claims.memberId) or.push({ recipientType: "member", recipientIds: String(claims.memberId) });
    or.push({ recipientType: "user", recipientIds: String(claims.userId) });
    query = { ...base, $or: or };
  }

  const res = await Notification.updateMany(query, {
    $push: { readBy: { userId: claims.userId, readAt: new Date() } },
  });
  return json({ ok: true, modified: res.modifiedCount ?? 0 });
});
