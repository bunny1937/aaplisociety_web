import { z } from "zod";
import connectDB from "@/lib/mongodb";
import { withRoute, json, ApiError, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import { EVENT_STATUS } from "@/lib/amenities/constants";
import { memberContext, requireCapability } from "@/lib/amenities/memberContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import {
  joinEventWaitlist, leaveEventWaitlist, WaitlistError,
} from "@/lib/amenities/waitlistService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const joinSchema = z.object({
  guestCount: z.number().int().min(0).max(20).optional(),
});

function toApiError(err) {
  if (!(err instanceof WaitlistError)) return err;
  const map = {
    WAITLIST_DISABLED: 409,
    EVENT_NOT_OPEN: 409,
    ALREADY_REGISTERED: 409,
    NOT_QUEUED: 404,
  };
  return new ApiError(map[err.code] || 400, { error: err.message, code: err.code });
}

async function loadEvent(ctx, id) {
  const event = await AmenityEvent.findOne({
    _id: id, societyId: ctx.societyId, status: { $ne: EVENT_STATUS.DRAFT },
  }).lean();
  if (!event) throw new ApiError(404, "That event could not be found");
  return event;
}

// POST /api/v1/amenities/events/[id]/waitlist — join the queue
export const POST = withRoute(async (request, { params }) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.JOIN_WAITLIST);

  const { id } = await params;
  const parsed = joinSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return zodError(parsed);

  const event = await loadEvent(ctx, id);

  try {
    const { entry } = await joinEventWaitlist({
      societyId: ctx.societyId,
      event,
      member: {
        memberId: ctx.memberId,
        userId: ctx.userId,
        name: ctx.member?.name,
        flatNo: ctx.flatLabel,
      },
      guestCount: parsed.data.guestCount || 0,
    });

    return json({
      joined: true,
      position: entry.position,
      message: `You're number ${entry.position} on the waitlist. We'll notify you if a place opens up.`,
    }, { status: 201 });
  } catch (err) {
    throw toApiError(err);
  }
});

// DELETE /api/v1/amenities/events/[id]/waitlist — leave the queue
export const DELETE = withRoute(async (request, { params }) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);
  requireCapability(ctx, CAPABILITY.JOIN_WAITLIST);

  const { id } = await params;

  try {
    await leaveEventWaitlist({ eventId: id, memberId: ctx.memberId, actor: ctx.actor });
    return json({ left: true, message: "You've been removed from the waitlist." });
  } catch (err) {
    throw toApiError(err);
  }
});
