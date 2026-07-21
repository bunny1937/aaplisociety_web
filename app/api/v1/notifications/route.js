import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Notification } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/notifications — the Flutter client polls this (Socket.IO was removed
// for Vercel). Admin/security see the whole society feed; members see the
// notifications addressed to them (all | own member | own user). Each row is
// annotated with a `read` flag derived from readBy.
//
// Supports ?since=<ISO> for lightweight incremental polling and ?unread=1.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);

  const base = { societyId, isDeleted: { $ne: true } };
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) base.createdAt = { $gt: d };
  }

  let query;
  if (VISITOR_ACCESS_ROLES.includes(claims.role)) {
    query = base;
  } else {
    const or = [{ recipientType: "all" }];
    if (claims.memberId) or.push({ recipientType: "member", recipientIds: String(claims.memberId) });
    or.push({ recipientType: "user", recipientIds: String(claims.userId) });
    query = { ...base, $or: or };
  }

  const rows = await Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  const uid = String(claims.userId);
  let items = rows.map((n) => ({
    _id: String(n._id),
    type: n.type,
    title: n.title ?? null,
    message: n.message ?? null,
    priority: n.priority ?? "normal",
    metadata: n.metadata ?? {},
    createdAt: n.createdAt,
    read: Array.isArray(n.readBy) && n.readBy.some((r) => String(r.userId) === uid),
  }));
  if (unreadOnly) items = items.filter((i) => !i.read);

  const unreadCount = items.filter((i) => !i.read).length;
  return json({ notifications: items, unreadCount });
});
