import { createHash } from "node:crypto";
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

  // --- Conditional GET -----------------------------------------------------
  // This route is polled more than every other route in the system combined.
  // The overwhelmingly common case is "nothing new since ?since=", and we were
  // still serialising JSON and sending a body for it every single time.
  //
  // The ETag is derived from what the client can actually observe: how many rows
  // it would get, the newest row's timestamp, and the unread count (which can
  // change without a new row when something is marked read). If all three match
  // what the client already holds, answer 304 with no body at all.
  //
  // This does NOT reduce invocations - only the client's poll interval can do
  // that - but it removes the response body, the JSON parse on the phone, and
  // the bandwidth, on the ~95% of polls that carry no news.
  const newest = items.length ? new Date(items[0].createdAt).getTime() : 0;
  const etag = `W/"${createHash("sha1")
    .update(`${items.length}:${newest}:${unreadCount}`)
    .digest("base64url")}"`;

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "no-store" },
    });
  }

  return json(
    { notifications: items, unreadCount },
    { headers: { ETag: etag, "Cache-Control": "no-store" } },
  );
});
