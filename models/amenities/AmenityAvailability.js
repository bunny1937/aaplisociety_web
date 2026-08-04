import mongoose from "mongoose";
import { CLOSURE_TYPES } from "@/lib/amenities/constants";

// amenity_availability — two shapes in one collection, discriminated by `type`:
//
//   WEEKLY  : a recurring window for one day of the week. Multiple rows per day
//             are allowed, which is how split timings (06:00-10:00 and
//             17:00-21:00 for a pool) are expressed. Without this the module
//             could only ever model one continuous window per day.
//   CLOSURE : a dated holiday or temporary closure that overrides the weekly
//             grid for its date range.
const AmenityAvailabilitySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    type: { type: String, enum: ["WEEKLY", "CLOSURE"], required: true, index: true },

    // --- WEEKLY ---
    dayOfWeek: { type: Number, min: 0, max: 6, default: null },
    openTime: { type: String, default: null }, // "HH:mm"
    closeTime: { type: String, default: null },

    // --- CLOSURE ---
    closureType: { type: String, enum: CLOSURE_TYPES, default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    reason: { type: String, trim: true, maxlength: 300 },
    // A closure may cover only part of a day (e.g. deep cleaning 14:00-16:00).
    allDay: { type: Boolean, default: true },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

AmenityAvailabilitySchema.index({ amenityId: 1, type: 1, dayOfWeek: 1 });
AmenityAvailabilitySchema.index({ amenityId: 1, type: 1, startDate: 1, endDate: 1 });

export default mongoose.models.AmenityAvailability ||
  mongoose.model("AmenityAvailability", AmenityAvailabilitySchema, "amenity_availability");
