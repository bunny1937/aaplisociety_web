import mongoose from "mongoose";
import { REGISTRATION_STATUSES, REGISTRATION_STATUS } from "@/lib/amenities/constants";

// amenity_event_registrations
const AmenityEventRegistrationSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityEvent", required: true, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    memberName: { type: String, trim: true, maxlength: 120 },
    flatNo: { type: String, trim: true, maxlength: 30 },
    guestCount: { type: Number, min: 0, default: 0 },
    guestNames: { type: [String], default: [] },
    status: { type: String, enum: REGISTRATION_STATUSES, default: REGISTRATION_STATUS.CONFIRMED, index: true },
    // Set when the row was created by a waitlist promotion rather than a
    // direct registration — feeds the "waitlist conversion" KPI.
    fromWaitlist: { type: Boolean, default: false },
    registeredAt: { type: Date, default: Date.now },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityAttendance", default: null },
  },
  { timestamps: true },
);

// One live registration per member per event. Cancelled rows are excluded from
// the constraint so a resident who cancelled can register again.
AmenityEventRegistrationSchema.index(
  { eventId: 1, memberId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [REGISTRATION_STATUS.CONFIRMED, REGISTRATION_STATUS.ATTENDED] },
    },
  },
);
AmenityEventRegistrationSchema.index({ societyId: 1, memberId: 1, createdAt: -1 });

export default mongoose.models.AmenityEventRegistration ||
  mongoose.model(
    "AmenityEventRegistration",
    AmenityEventRegistrationSchema,
    "amenity_event_registrations",
  );
