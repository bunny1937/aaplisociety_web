import mongoose from "mongoose";

// amenity_time_slots — the materialised slot grid for an amenity.
//
// Slots are generated from Amenity.slotPolicy + the weekly availability grid
// (see lib/amenities/slotEngine.js) and stored rather than computed per
// request, because attendance rows, event rows and analytics rollups all
// reference a slot by id. Computing them on the fly would make those
// references unstable the moment an admin changes the slot duration.
//
// These are *templates* keyed by day-of-week, not dated instances: one row per
// (amenity, day, start) rather than per calendar day, so a township with 500
// amenities does not accumulate millions of rows. Bookings, when enabled, will
// add a dated amenity_slot_instances collection referencing these.
const AmenityTimeSlotSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, required: true }, // "HH:mm"
    endTime: { type: String, required: true },
    // Minutes from midnight — denormalised so "which slot is it right now"
    // is an indexed numeric range query instead of string parsing per row.
    startMinutes: { type: Number, required: true },
    endMinutes: { type: Number, required: true },
    capacity: { type: Number, default: null }, // null = inherit amenity capacity
    label: { type: String, trim: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
    // Slots an admin hand-edited are preserved across regeneration.
    isCustom: { type: Boolean, default: false },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

AmenityTimeSlotSchema.index(
  { amenityId: 1, dayOfWeek: 1, startMinutes: 1 },
  { unique: true },
);
AmenityTimeSlotSchema.index({ societyId: 1, amenityId: 1, isActive: 1 });

export default mongoose.models.AmenityTimeSlot ||
  mongoose.model("AmenityTimeSlot", AmenityTimeSlotSchema, "amenity_time_slots");
