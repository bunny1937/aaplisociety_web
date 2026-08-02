import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { visitorCreateSchema } from "@/lib/v1/schemas";
import { Visitor, Blacklist, Member, User } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES, OCCUPANCY_TYPES } from "@/lib/v1/constants";
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
    // Owners get a lighter-weight feed: only guests who actually made it
    // through the gate, not the full pending/approved/rejected request log.
    // Tenants (who live on-site day to day) see everything, entry and exit.
    if (claims.occupancyType === OCCUPANCY_TYPES.OWNER) {
      query.purpose = "Guest";
      query.status = { $in: ["Entered", "Exited"] };
    }
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
      // The Flutter guard screens (gate_tab.dart's SOS card and "Awaiting
      // approval" card in particular) read flatNo/wing/ownerName/
      // contactNumber at the TOP LEVEL of each visitor row — but .populate()
      // only nests those under v.memberId. Nothing flattened them, so every
      // one of those reads was silently undefined; SOS is the one place with
      // no other source of flat info to fall back on, hence "no flat
      // recorded" specifically there.
      const member = v.memberId;
      if (member && typeof member === "object") {
        v.flatNo = member.flatNo;
        v.wing = member.wing;
        v.ownerName = member.ownerName;
        v.contactNumber = member.contactNumber;
      }

      // SOS acknowledgement state.
      //
      // The resident's "We are safe - silence the alarm" card decides whether
      // it is still armed by looking at `sosAck.at`. But an SOS can be closed
      // out in more than one way: the GUARD acknowledges it at the gate, or the
      // record's status moves to Resolved. Those paths never wrote `sosAck`, so
      // the row came back looking un-acknowledged and the alert re-armed on
      // every refresh - an emergency the guard had handled hours earlier kept
      // reappearing, and pressing "we are safe" again fixed nothing because the
      // field the app watched was not the field being written.
      //
      // Normalise all of them into one shape the client can trust.
      const ackAt =
        v.sosAck?.at ||
        v.sosAcknowledgedAt ||
        v.resolvedAt ||
        (v.sosResolved === true ? v.updatedAt : null) ||
        (/^(resolved|handled|closed|acknowledged|safe)$/i.test(String(v.sosStatus || ""))
          ? v.updatedAt
          : null);
      if (ackAt) {
        v.sosAck = {
          at: ackAt,
          by: v.sosAck?.by || v.sosAcknowledgedBy || "Resolved",
        };
        v.sosResolved = true;
      }
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
