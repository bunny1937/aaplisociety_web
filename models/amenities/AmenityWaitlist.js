import mongoose from "mongoose";
import { WAITLIST_STATUSES, WAITLIST_STATUS, WAITLIST_SCOPES, WAITLIST_SCOPE } from "@/lib/amenities/constants";

// amenity_waitlists — generic queue, usable for a full event today and for
// slots/bookings once those flags flip on.
const AmenityWaitlistSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    scope: { type: String, enum: WAITLIST_SCOPES, default: WAITLIST_SCOPE.EVENT, index: true },
    // Whichever of these the scope implies; kept as separate typed fields
    // rather than a polymorphic targetId so indexes stay useful.
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityEvent", default: null, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", default: null, index: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityTimeSlot", default: null },
    slotDate: { type: Date, default: null },

    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    memberName: { type: String, trim: true, maxlength: 120 },
    flatNo: { type: String, trim: true, maxlength: 30 },
    guestCount: { type: Number, min: 0, default: 0 },

    // Monotonic queue position assigned at join time. Promotion always takes
    // the lowest `position` still WAITING, so the queue is strictly FIFO and
    // auditable — never "whoever the query happened to return first".
    position: { type: Number, required: true },
    status: { type: String, enum: WAITLIST_STATUSES, default: WAITLIST_STATUS.WAITING, index: true },
    joinedAt: { type: Date, default: Date.now },
    promotedAt: { type: Date },
    // Set on promotion: the seat is reserved but lost if the member does not
    // confirm/pay before this passes (a deferred flow; the timestamp is
    // recorded now so nothing needs to change when it lands).
    holdExpiresAt: { type: Date, default: null },
    leftAt: { type: Date },
    notifiedAt: { type: Date },
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityEventRegistration", default: null },
  },
  { timestamps: true },
);

AmenityWaitlistSchema.index(
  { eventId: 1, memberId: 1 },
  { unique: true, partialFilterExpression: { status: WAITLIST_STATUS.WAITING, eventId: { $type: "objectId" } } },
);
// Guards the position race directly: two concurrent joins computing the same
// "next" position collide here as a duplicate key, and joinEventWaitlist
// retries rather than letting both entries land on the same position.
AmenityWaitlistSchema.index(
  { eventId: 1, position: 1 },
  { unique: true, partialFilterExpression: { status: WAITLIST_STATUS.WAITING, eventId: { $type: "objectId" } } },
);
AmenityWaitlistSchema.index({ eventId: 1, status: 1, position: 1 });
AmenityWaitlistSchema.index({ societyId: 1, memberId: 1, status: 1 });

export default mongoose.models.AmenityWaitlist ||
  mongoose.model("AmenityWaitlist", AmenityWaitlistSchema, "amenity_waitlists");
