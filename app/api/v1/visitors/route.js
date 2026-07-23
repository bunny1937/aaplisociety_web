import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { visitorCreateSchema } from "@/lib/v1/schemas";
import { Visitor, Blacklist, Member, User } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";
import { presignDownload } from "@/lib/v1/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/visitors — admins/security see the whole society; members see only
// their own flat's visitors.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 200);

  const query = { societyId };
  if (!VISITOR_ACCESS_ROLES.includes(claims.role)) {
    if (!claims.memberId) return json({ visitors: [] });
    query.memberId = claims.memberId;
  }
  if (status) query.status = status;

  const visitors = await Visitor.find(query)
    .sort({ entryTime: -1 })
    .limit(limit)
    .populate({ path: "memberId", model: Member, select: "flatNo wing ownerName contactNumber" })
    .populate({ path: "enteredBy", model: User, select: "name username phone" })
    .populate({ path: "assignedGuardId", model: User, select: "name username phone" })
    .lean();

  // Presigning is a local crypto op (no network round trip) — cheap enough
  // to do per row for the handful of visitors with a photo attached.
  await Promise.all(
    visitors.map(async (v) => {
      if (v.photoKey) v.photoUrl = await presignDownload(v.photoKey);
      const guard = v.assignedGuardId || v.enteredBy;
      v.guardPhone = guard?.phone || null;
      v.guardName = guard?.name || guard?.username || null;
    }),
  );

  return json({ visitors });
});

// POST /v1/visitors — a resident pre-registers an expected visitor.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can register visitors");
  const body = await req.json().catch(() => ({}));
  const parsed = visitorCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const flagged = await Blacklist.findOne({ societyId, phone: data.phone, active: true });

  const visitor = await Visitor.create({
    societyId,
    memberId: claims.memberId,
    name: data.name,
    phone: data.phone,
    purpose: data.purpose,
    purposeNote: data.purposeNote,
    vehicleNumber: data.vehicleNumber,
    status: "Pending",
    entryMethod: "Manual",
    expiresAt: data.expectedAt ? new Date(data.expectedAt) : undefined,
    isBlacklisted: !!flagged,
    blacklistReason: flagged?.reason,
  });

  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: claims.memberId,
    status: visitor.status,
    entryMethod: visitor.entryMethod,
    isBlacklisted: visitor.isBlacklisted,
  });

  return json({ visitor }, { status: 201 });
});