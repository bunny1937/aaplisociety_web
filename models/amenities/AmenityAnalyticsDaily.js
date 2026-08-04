import mongoose from "mongoose";

// amenity_analytics_daily — pre-aggregated one row per (amenity, day).
//
// Why a rollup at all: the analytics screen asks for peak hours, average
// occupancy and utilisation over a year. Answering that from raw attendance
// means aggregating millions of rows per society per page load. The rollup is
// updated incrementally on check-out (and repairable by a nightly recompute),
// so the dashboard reads at most 365 small documents per amenity.
const AmenityAnalyticsDailySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    amenityName: { type: String, default: "" },
    dayKey: { type: String, required: true, index: true }, // yyyy-mm-dd, society-local
    date: { type: Date, required: true },
    dayOfWeek: { type: Number, min: 0, max: 6 },

    checkIns: { type: Number, default: 0 },
    residentCheckIns: { type: Number, default: 0 },
    visitorCheckIns: { type: Number, default: 0 },
    staffCheckIns: { type: Number, default: 0 },
    uniqueMembers: { type: Number, default: 0 },
    guestCount: { type: Number, default: 0 },
    qrCheckIns: { type: Number, default: 0 },
    manualCheckIns: { type: Number, default: 0 },
    overrideCheckIns: { type: Number, default: 0 },

    totalDurationMins: { type: Number, default: 0 },
    avgDurationMins: { type: Number, default: 0 },
    peakOccupancy: { type: Number, default: 0 },
    // 24 buckets of check-in counts. An array rather than 24 fields so the
    // peak-hour query is a single unwind and adding a finer granularity later
    // does not change the schema shape.
    hourlyCheckIns: { type: [Number], default: () => new Array(24).fill(0) },

    capacityUtilisationPct: { type: Number, default: 0 },
    maintenanceDowntimeMins: { type: Number, default: 0 },
    eventsHeld: { type: Number, default: 0 },
    eventAttendance: { type: Number, default: 0 },
    incidentsReported: { type: Number, default: 0 },

    // Set by the nightly recompute so a partially-rolled-up day is visibly
    // provisional rather than silently wrong.
    recomputedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AmenityAnalyticsDailySchema.index({ amenityId: 1, dayKey: 1 }, { unique: true });
AmenityAnalyticsDailySchema.index({ societyId: 1, dayKey: -1 });

export default mongoose.models.AmenityAnalyticsDaily ||
  mongoose.model("AmenityAnalyticsDaily", AmenityAnalyticsDailySchema, "amenity_analytics_daily");
