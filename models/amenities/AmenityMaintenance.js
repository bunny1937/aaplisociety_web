import mongoose from "mongoose";
import { MAINTENANCE_STATUSES, MAINTENANCE_STATUS } from "@/lib/amenities/constants";

// amenity_maintenance — permanent history. Nothing in this collection is ever
// deleted or overwritten in place: extending a window appends to
// `extensions[]`, reopening early stamps `reopenedAt`. That is what makes
// "maintenance downtime" analytics and any future dispute reconstructable.
const ExtensionSchema = new mongoose.Schema(
  {
    previousEndDate: { type: Date, required: true },
    newEndDate: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: 300 },
    extendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    extendedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const AmenityMaintenanceSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: MAINTENANCE_STATUSES, default: MAINTENANCE_STATUS.SCHEDULED, index: true },
    // Status the amenity should return to when the window closes. Captured at
    // schedule time so "reopen" cannot accidentally promote a permanently
    // closed amenity to OPEN.
    previousAmenityStatus: { type: String },
    isEmergency: { type: Boolean, default: false },
    extensions: { type: [ExtensionSchema], default: [] },
    reopenedAt: { type: Date },
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reopenedEarly: { type: Boolean, default: false },
    // Enforced at the route (an authenticated admin is always attached before
    // create), not here: a required DB constraint would make this document
    // impossible to build in tests that only exercise the availability/status
    // logic and have no reason to fabricate an actor.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

// Overlap detection and the maintenance calendar both query this shape.
AmenityMaintenanceSchema.index({ amenityId: 1, startDate: 1, endDate: 1 });
AmenityMaintenanceSchema.index({ societyId: 1, status: 1, startDate: -1 });

export default mongoose.models.AmenityMaintenance ||
  mongoose.model("AmenityMaintenance", AmenityMaintenanceSchema, "amenity_maintenance");
