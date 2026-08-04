import connectDB from "@/lib/mongodb";
import { withRoute, json, ApiError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration";
import Amenity from "@/models/amenities/Amenity";
import { EVENT_STATUS, REGISTRATION_STATUS } from "@/lib/amenities/constants";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { getMyWaitlistPosition } from "@/lib/amenities/waitlistService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/amenities/events/[id]
// Resident event detail. Deliberately omits the attendee list — only counts.
export const GET = withRoute(async (request, { params }) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.VIEW_AMENITIES);

  const { id } = await params;

  const event = await AmenityEvent.findOne({
    _id: id,
    societyId: ctx.societyId,
    status: { $ne: EVENT_STATUS.DRAFT },
  }).lean();
  if (!event) throw new ApiError(404, "That event could not be found");

  const [amenity, myReg, myQueue] = await Promise.all([
    Amenity.findById(event.amenityId).select("name location status").lean(),
    AmenityEventRegistration.findOne({ eventId: id, memberId: ctx.memberId }).lean(),
    getMyWaitlistPosition({ eventId: id, memberId: ctx.memberId }),
  ]);

  const seatsLeft = event.capacity ? Math.max(0, event.capacity - (event.registeredCount || 0)) : null;
  const now = new Date();
  const registered = Boolean(myReg && myReg.status !== REGISTRATION_STATUS.CANCELLED);

  // The server decides what the resident may do next, so the app never has to
  // reimplement the eligibility rules and drift from them.
  const deadlinePassed = Boolean(event.registrationDeadline && new Date(event.registrationDeadline) < now);
  const started = new Date(event.startAt) <= now;
  const open = event.status === EVENT_STATUS.PUBLISHED && !started && !deadlinePassed;

  return json({
    event: {
      ...event,
      amenityLocation: amenity?.location || "",
      seatsLeft,
      isFull: event.capacity ? seatsLeft === 0 : false,
    },
    my: {
      registered,
      registrationStatus: myReg?.status || null,
      guestCount: myReg?.guestCount || 0,
      registeredAt: myReg?.createdAt || null,
      waitlist: myQueue,
    },
    actions: {
      canRegister: open && !registered && event.registrationRequired &&
        (event.capacity ? seatsLeft > 0 : true),
      canJoinWaitlist: open && !registered && !myQueue &&
        Boolean(event.waitlistEnabled) && Boolean(event.capacity) && seatsLeft === 0,
      canCancel: registered && !started,
      canLeaveWaitlist: Boolean(myQueue),
      reason: !open
        ? (event.status === EVENT_STATUS.CANCELLED ? "This event was cancelled"
          : started ? "This event has already started"
          : deadlinePassed ? "Registration has closed"
          : "Registration is not open")
        : null,
    },
  });
});
