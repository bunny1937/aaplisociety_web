import { z } from "zod";
import connectDB from "@/lib/mongodb";
import { withRoute, json, ApiError, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import { EVENT_STATUS } from "@/lib/amenities/constants";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { registerForEvent, cancelRegistration, RegistrationError } from "@/lib/amenities/eventService";
import { getSettings } from "@/lib/amenities/settingsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  guestCount: z.number().int().min(0).max(20).optional(),
  note: z.string().trim().max(300).optional(),
});

const cancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

// Maps service error codes onto HTTP status codes. The service layer stays
// transport-agnostic, and the resident sees the service's own wording.
function toApiError(err) {
  if (!(err instanceof RegistrationError)) return err;
  const map = {
    EVENT_CANCELLED: 409,
    EVENT_NOT_OPEN: 409,
    EVENT_STARTED: 409,
    REGISTRATION_CLOSED: 409,
    ALREADY_REGISTERED: 409,
    EVENT_FULL: 409,
    NO_REGISTRATION: 400,
    GUESTS_NOT_ALLOWED: 400,
    GUEST_LIMIT: 400,
    NOT_REGISTERED: 404,
  };
  return new ApiError(map[err.code] || 400, {
    error: err.message,
    code: err.code,
    ...(err.meta || {}),
  });
}

async function loadEvent(ctx, id) {
  const event = await AmenityEvent.findOne({
    _id: id,
    societyId: ctx.societyId,
    status: { $ne: EVENT_STATUS.DRAFT },
  }).lean();
  if (!event) throw new ApiError(404, "That event could not be found");
  return event;
}

// POST /api/v1/amenities/events/[id]/register
export const POST = withRoute(async (request, { params }) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.REGISTER_EVENT);

  const { id } = await params;
  const parsed = registerSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodError(parsed);

  const event = await loadEvent(ctx, id);

  try {
    const { registration, seatsLeft } = await registerForEvent({
      societyId: ctx.societyId,
      event,
      member: {
        memberId: ctx.memberId,
        userId: ctx.userId,
        name: ctx.member?.name,
        flatNo: ctx.flatLabel,
        occupancyType: ctx.occupancyType,
      },
      guestCount: parsed.data.guestCount || 0,
      note: parsed.data.note,
    });

    return json({
      registered: true,
      registration,
      seatsLeft,
      message: `You're registered for ${event.title}.`,
    }, { status: 201 });
  } catch (err) {
    throw toApiError(err);
  }
});

// DELETE /api/v1/amenities/events/[id]/register
// Cancelling frees the seat and immediately promotes the next resident waiting.
export const DELETE = withRoute(async (request, { params }) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.REGISTER_EVENT);

  const { id } = await params;
  const parsed = cancelSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodError(parsed);

  const event = await loadEvent(ctx, id);
  const settings = await getSettings(ctx.societyId);

  try {
    const { registration, promoted } = await cancelRegistration({
      societyId: ctx.societyId,
      event,
      memberId: ctx.memberId,
      reason: parsed.data.reason,
      settings,
      actor: ctx.actor,
    });

    return json({
      cancelled: true,
      registration,
      // Surfaced so the app can say "your place went to the next resident".
      promotedFromWaitlist: promoted.length,
      message: `Your registration for ${event.title} has been cancelled.`,
    });
  } catch (err) {
    throw toApiError(err);
  }
});
