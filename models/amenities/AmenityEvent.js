import mongoose from "mongoose";
import { EVENT_STATUSES, EVENT_STATUS } from "@/lib/amenities/constants";

// amenity_events — society events hosted at an amenity.
const AmenityEventSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    // Nullable: a society meeting in the open garden may not map to a managed
    // amenity. Venue text then carries the location.
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", default: null, index: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityTimeSlot", default: null },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 4000 },
    organizerName: { type: String, trim: true, maxlength: 120 },
    organizerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    organizerPhone: { type: String, trim: true, maxlength: 20 },
    venue: { type: String, trim: true, maxlength: 200 },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },

    capacity: { type: Number, min: 0, default: null }, // null = unlimited
    registrationRequired: { type: Boolean, default: true },
    registrationDeadline: { type: Date, default: null },
    guestsAllowed: { type: Boolean, default: false },
    maxGuestsPerRegistration: { type: Number, min: 0, default: 0 },
    waitlistEnabled: { type: Boolean, default: true },

    status: { type: String, enum: EVENT_STATUSES, default: EVENT_STATUS.PUBLISHED, index: true },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    cancelledAt: { type: Date, default: null },

    // Atomic counters. registeredCount is guarded by $inc + a capacity filter
    // so two residents racing for the last seat cannot both win.
    registeredCount: { type: Number, default: 0, min: 0 },
    guestCount: { type: Number, default: 0, min: 0 },
    waitlistCount: { type: Number, default: 0, min: 0 },
    attendedCount: { type: Number, default: 0, min: 0 },

    reminderSentAt: { type: Date, default: null },

    // Enforced at the route (an authenticated admin is always attached before
    // create), not here - see AmenityMaintenance for the same reasoning.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

AmenityEventSchema.index({ societyId: 1, status: 1, startAt: 1 });
AmenityEventSchema.index({ amenityId: 1, startAt: 1 });
// Drives the reminder cron: published, starting soon, not yet reminded.
AmenityEventSchema.index({ status: 1, reminderSentAt: 1, startAt: 1 });

export default mongoose.models.AmenityEvent ||
  mongoose.model("AmenityEvent", AmenityEventSchema, "amenity_events");
