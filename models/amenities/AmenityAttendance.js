import mongoose from "mongoose";
import {
  ATTENDEE_TYPES,
  ATTENDEE_TYPE,
  CHECKIN_METHODS,
  CHECKIN_METHOD,
} from "@/lib/amenities/constants";

// amenity_attendance — append-only. The brief is explicit that attendance
// history is never deleted; there is deliberately no isDeleted flag and no
// delete route anywhere in this module. Corrections are made by writing a
// correction (adjustedBy / adjustmentReason), which keeps the original row
// intact.
const AmenityAttendanceSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    // Denormalised at check-in time so history reads correctly even after the
    // amenity is later renamed.
    amenityName: { type: String, default: "" },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityTimeSlot", default: null },
    slotLabel: { type: String, default: "" },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityEvent", default: null, index: true },

    attendeeType: { type: String, enum: ATTENDEE_TYPES, default: ATTENDEE_TYPE.RESIDENT, index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    residentName: { type: String, trim: true, maxlength: 120 },
    flatNo: { type: String, trim: true, maxlength: 30 },
    occupancyType: { type: String, trim: true, maxlength: 20 },
    hostMemberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", default: null },
    guestCount: { type: Number, default: 0 },

    // Populated for visitor attendance; links back to the existing gate record
    // when the visitor came through the gate flow.
    amenityVisitorId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityVisitor", default: null },
    visitorId: { type: mongoose.Schema.Types.ObjectId, ref: "Visitor", default: null },
    visitorName: { type: String, trim: true, maxlength: 120 },
    visitorPhone: { type: String, trim: true, maxlength: 20 },

    timeIn: { type: Date, required: true, default: Date.now, index: true },
    timeOut: { type: Date, default: null },
    // Written once at check-out. Denormalised so analytics never has to
    // subtract dates across millions of rows.
    durationMins: { type: Number, default: null },
    // Set by autoCheckoutStale rather than a real check-out, so averages and
    // history can tell a forgotten session apart from an intentional one.
    autoCheckedOut: { type: Boolean, default: false },

    checkInMethod: { type: String, enum: CHECKIN_METHODS, default: CHECKIN_METHOD.MANUAL },
    checkOutMethod: { type: String, enum: CHECKIN_METHODS, default: null },
    checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    checkedInByName: { type: String, default: "" },
    checkedInByRole: { type: String, default: null },
    checkedOutBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    checkedOutByName: { type: String, default: "" },
    qrTokenId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityQrToken", default: null },

    // Set when an admin/guard forced an entry that policy would have refused
    // (outside hours, over capacity). Kept visible for compliance review.
    isOverride: { type: Boolean, default: false },
    overrideReason: { type: String, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 500 },

    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adjustmentReason: { type: String, trim: true, maxlength: 300 },

    // Local calendar day (yyyy-mm-dd) the check-in belongs to. Precomputed so
    // the daily rollup and "my history" queries are index hits rather than
    // $dateToString over the whole collection.
    dayKey: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

// The hot query: "who is currently inside this amenity" (live occupancy panel,
// clear-the-building on emergency).
AmenityAttendanceSchema.index(
  { amenityId: 1, timeOut: 1 },
  { partialFilterExpression: { timeOut: null } },
);
// "Is this member currently inside this amenity" (duplicate check-in guard).
// unique is load-bearing, not an optimisation: the findOne pre-check in
// checkIn() is a TOCTOU race under concurrent requests, and this index is what
// actually stops two simultaneous taps from creating two open rows.
AmenityAttendanceSchema.index(
  { amenityId: 1, memberId: 1, timeOut: 1 },
  { unique: true, partialFilterExpression: { timeOut: null, memberId: { $type: "objectId" } } },
);
AmenityAttendanceSchema.index({ societyId: 1, amenityId: 1, dayKey: 1 });
AmenityAttendanceSchema.index({ societyId: 1, memberId: 1, timeIn: -1 });
AmenityAttendanceSchema.index({ eventId: 1, memberId: 1 });

export default mongoose.models.AmenityAttendance ||
  mongoose.model("AmenityAttendance", AmenityAttendanceSchema, "amenity_attendance");
