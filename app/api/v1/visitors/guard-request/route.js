import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { guardRequestSchema } from "@/lib/v1/schemas";
import { Visitor, Member, Blacklist, User } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/guard-request — a guard registers a walk-in visitor on
// behalf of a resident, who must then approve. Idempotent on clientRef.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const parsed = guardRequestSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const existing = await Visitor.findOne({ societyId, "offlineMeta.clientRef": data.clientRef });
  if (existing) return json({ visitor: existing, deduped: true });

  const member = await Member.findOne({ _id: data.memberId, societyId }).select("_id");
  if (!member) throw new ApiError(404, "Member not found");
  const flagged = data.phone ? await Blacklist.findOne({ societyId, phone: data.phone, active: true }) : null;

  try {
    const visitor = await Visitor.create({
      societyId,
      memberId: member._id,
      name: data.name,
      phone: data.phone || "0000000000",
      purpose: data.purpose,
      vehicleNumber: data.vehicleNumber,
      status: "Pending",
      entryMethod: "GuardRequest",
      enteredBy: claims.userId,
      isBlacklisted: !!flagged,
      blacklistReason: flagged?.reason,
      offlineMeta: { queuedAt: new Date(data.queuedAt), syncedAt: new Date(), note: data.note, clientRef: data.clientRef },
      escalation: { level: 0, stopped: false },
    });
    const guard = await User.findById(claims.userId).select("name username");
    await notifyVisitorChange({
      visitorId: visitor._id,
      societyId,
      memberId: member._id,
      status: "Pending",
      entryMethod: "GuardRequest",
      isBlacklisted: visitor.isBlacklisted,
      guardId: claims.userId,
      guardName: guard?.name || guard?.username,
    });
    return json({ visitor }, { status: 201 });
  } catch (e) {
    if (e?.code === 11000) {
      const winner = await Visitor.findOne({ societyId, "offlineMeta.clientRef": data.clientRef });
      if (winner) return json({ visitor: winner, deduped: true });
    }
    throw e;
  }
});
