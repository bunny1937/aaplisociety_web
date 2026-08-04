import mongoose from "mongoose";
import { DEFAULT_INCIDENT_TYPES, FEATURE_FLAGS, DEFAULT_WAITLIST_HOLD_MINS } from "@/lib/amenities/constants";

// One settings document per society: the module's feature flags and the
// society-authored vocabularies (incident types, custom access roles).
//
// Flags live here rather than in environment variables because the unit of
// enablement is a society, not a deployment — one township can pilot bookings
// while every other society stays on the current scope.
const AmenitySettingSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      unique: true,
      index: true,
    },
    features: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...FEATURE_FLAGS }) },
    incidentTypes: { type: [String], default: () => [...DEFAULT_INCIDENT_TYPES] },
    // Roles offered when an amenity uses audience = CUSTOM.
    customAccessRoles: { type: [String], default: [] },
    // IANA zone used for dayKey bucketing and "is it open now". Societies are
    // single-timezone in practice, but hardcoding Asia/Kolkata would break the
    // first non-Indian deployment.
    timezone: { type: String, default: "Asia/Kolkata" },
    // Minutes before an event starts that the reminder cron fires.
    eventReminderLeadMins: { type: Number, default: 120 },
    // How long a promoted waitlist entry stays reserved before the next person
    // in the queue is offered the seat.
    waitlistHoldMins: { type: Number, default: DEFAULT_WAITLIST_HOLD_MINS },
    // Auto-close attendance rows nobody checked out of, so live occupancy does
    // not drift upward forever.
    autoCheckoutAfterMins: { type: Number, default: 240 },
    analyticsRetentionDays: { type: Number, default: 1095 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export default mongoose.models.AmenitySetting ||
  mongoose.model("AmenitySetting", AmenitySettingSchema, "amenity_settings");
