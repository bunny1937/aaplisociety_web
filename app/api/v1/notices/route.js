import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { noticeSchema } from "@/lib/v1/schemas";
import { Notice, User } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";
import { notifyNoticePosted } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/notices — all society members can read notices (pinned first).
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const notices = await Notice.find({ societyId }).sort({ pinned: -1, createdAt: -1 }).limit(100).lean();
  return json({ notices: notices.map((n) => ({ ...n, _id: String(n._id) })) });
});

// POST /v1/notices — admin/secretary posts a notice; fans out to the society.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, SOCIETY_ADMIN_ROLES);
  const body = await req.json().catch(() => ({}));
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const author = await User.findById(claims.userId).select("username");
  const createdByName = author?.username || "Admin";

  const notice = await Notice.create({
    societyId,
    createdBy: claims.userId,
    createdByName,
    type: data.type,
    priority: data.priority,
    title: data.title,
    description: data.description,
    pinned: !!data.pinned,
  });

  await notifyNoticePosted({
    noticeId: notice._id,
    societyId,
    title: notice.title,
    createdBy: claims.userId,
    createdByName,
  });
  return json({ notice: { ...notice.toObject(), _id: String(notice._id) } }, { status: 201 });
});
