import { z } from "zod";
import connectDB from "@/lib/mongodb";
import { withRoute, json, ApiError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration";
import AmenityWaitlist from "@/models/amenities/AmenityWaitlist";
import { EVENT_STATUS, REGISTRATION_STATUS, WAITLIST_STATUS } from "@/lib/amenities/constants";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { getSettings } from "@/lib/amenities/settingsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/amenities/events?scope=upcoming|past|mine&amenityId=
//
// The resident event feed. Draft and cancelled-in-draft events are never exposed:
// a committee drafting "Diwali party" should not have it appear in the app before
// they publish it.
export const GET = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.VIEW_AMENITIES);

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "upcoming";
  const limit = Math.min(Number(searchParams.get("limit")) || 25, 50);
  const now = new Date();

  const base = {
    societyId: ctx.societyId,
    status: { $in: [EVENT_STATUS.PUBLISHED, EVENT_STATUS.CANCELLED, EVENT_STATUS.COMPLETED] },
  };
  if (searchParams.get("amenityId")) base.amenityId = searchParams.get("amenityId");

  let filter = base;
  let sort = { startAt: 1 };

  if (scope === "past") {
    filter = { ...base, startAt: { $lt: now } };
    sort = { startAt: -1 };
  } else if (scope === "mine") {
    // Everything this resident has a stake in, including events they cancelled
    // out of, so their own history is complete.
    const [regs, queued] = await Promise.all([
      AmenityEventRegistration.find({ memberId: ctx.memberId }).select("eventId").lean(),
      AmenityWaitlist.find({ memberId: ctx.memberId, status: WAITLIST_STATUS.WAITING }).select("eventId").lean(),
    ]);
    const ids = [...new Set([...regs, ...queued].map((r) => String(r.eventId)))];
    filter = { ...base, _id: { $in: ids } };
    sort = { startAt: -1 };
  } else {
    filter = { ...base, startAt: { $gte: now }, status: EVENT_STATUS.PUBLISHED };
  }

  const events = await AmenityEvent.find(filter).sort(sort).limit(limit).lean();

  // Attach this resident's own state to each event so the app can render the
  // right button without a second request per card.
  const eventIds = events.map((e) => e._id);
  const [myRegs, myQueue, settings] = await Promise.all([
    AmenityEventRegistration.find({ eventId: { $in: eventIds }, memberId: ctx.memberId }).lean(),
    AmenityWaitlist.find({
      eventId: { $in: eventIds },
      memberId: ctx.memberId,
      status: { $in: [WAITLIST_STATUS.WAITING, WAITLIST_STATUS.PROMOTED] },
    }).lean(),
    getSettings(ctx.societyId),
  ]);
  const regMap = new Map(myRegs.map((r) => [String(r.eventId), r]));
  const queueMap = new Map(myQueue.map((q) => [String(q.eventId), q]));

  return json({
    events: events.map((e) => {
      const reg = regMap.get(String(e._id));
      const queue = queueMap.get(String(e._id));
      const seatsLeft = e.capacity ? Math.max(0, e.capacity - (e.registeredCount || 0)) : null;
      return {
        _id: e._id,
        amenityId: e.amenityId,
        amenityName: e.amenityName,
        title: e.title,
        description: e.description,
        organizerName: e.organizerName,
        venue: e.venue,
        startAt: e.startAt,
        endAt: e.endAt,
        status: e.status,
        cancellationReason: e.cancellationReason,
        registrationRequired: e.registrationRequired,
        registrationDeadline: e.registrationDeadline,
        guestsAllowed: e.guestsAllowed,
        maxGuestsPerRegistration: e.maxGuestsPerRegistration,
        waitlistEnabled: e.waitlistEnabled,
        capacity: e.capacity,
        // Aggregate counts only — never the attendee list. Publishing who from
        // which flat is attending would leak across the whole society.
        registeredCount: e.registeredCount || 0,
        waitlistCount: e.waitlistCount || 0,
        seatsLeft,
        isFull: e.capacity ? seatsLeft === 0 : false,
        my: {
          registered: Boolean(reg && reg.status !== REGISTRATION_STATUS.CANCELLED),
          registrationStatus: reg?.status || null,
          guestCount: reg?.guestCount || 0,
          waitlisted: Boolean(queue),
          waitlistPosition: queue?.position || null,
          waitlistHoldExpiresAt: queue?.holdExpiresAt || null,
        },
      };
    }),
    reminderLeadMins: settings.eventReminderLeadMins,
  });
});
