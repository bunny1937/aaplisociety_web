import mongoose from "mongoose";
import {
  AMENITY_STATUSES,
  AMENITY_STATUS,
  ATTENDANCE_MODES,
  ATTENDANCE_MODE,
  ACCESS_AUDIENCES,
  ACCESS_AUDIENCE,
} from "@/lib/amenities/constants";

// Sub-documents are used for the strictly 1:1 configuration blocks (access,
// capacity, slot policy, visitor policy). Anything 1:N — rules, availability
// windows, closures, generated slots, maintenance, attendance — lives in its
// own collection so a clubhouse with 400 slot rows never bloats the document
// every amenity list query has to read.

const AccessSchema = new mongoose.Schema(
  {
    audience: { type: String, enum: ACCESS_AUDIENCES, default: ACCESS_AUDIENCE.EVERYONE },
    // Only meaningful when audience === CUSTOM. Free-form on purpose: societies
    // invent roles ("Trustee", "Managing Committee", "Domestic Help").
    customRoles: { type: [String], default: [] },
    minAge: { type: Number, min: 0, max: 120, default: null },
    maxAge: { type: Number, min: 0, max: 120, default: null },
  },
  { _id: false },
);

const CapacitySchema = new mongoose.Schema(
  {
    // amenity_capacity in the brief. Kept inline because it is exactly one row
    // per amenity and is read on every capacity check — a join here would cost
    // a round trip on the hottest path in the module.
    unlimited: { type: Boolean, default: true },
    maxOccupancy: { type: Number, min: 0, default: null },
    // Percentage of maxOccupancy at which the dashboard turns amber.
    warningThresholdPct: { type: Number, min: 1, max: 100, default: 80 },
  },
  { _id: false },
);

const SlotPolicySchema = new mongoose.Schema(
  {
    // amenity_time_slots' *policy*; the generated slots themselves are rows in
    // the AmenityTimeSlot collection.
    enabled: { type: Boolean, default: false },
    slotDurationMins: { type: Number, min: 5, max: 720, default: 60 },
    gapBetweenSlotsMins: { type: Number, min: 0, max: 240, default: 0 },
    bufferTimeMins: { type: Number, min: 0, max: 240, default: 0 },
    maxCapacityPerSlot: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const VisitorPolicySchema = new mongoose.Schema(
  {
    allowed: { type: Boolean, default: false },
    maxVisitorsPerResident: { type: Number, min: 0, default: 2 },
    maxVisitorsTotal: { type: Number, min: 0, default: null },
    allowedFrom: { type: String, default: null }, // "HH:mm"
    allowedTo: { type: String, default: null },
    approvalRequired: { type: Boolean, default: false },
    // Restricts which visitor purposes may be brought in, using the existing
    // Visitor.purpose vocabulary. Empty array = no restriction.
    allowedVisitorTypes: { type: [String], default: [] },
  },
  { _id: false },
);

const AmenitySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityCategory", required: true, index: true },

    // --- Basic information ---
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 2000 },
    location: { type: String, trim: true, maxlength: 200 },
    contactPerson: {
      name: { type: String, trim: true, maxlength: 80 },
      phone: { type: String, trim: true, maxlength: 20 },
      role: { type: String, trim: true, maxlength: 60 },
    },
    isActive: { type: Boolean, default: true, index: true },
    displayOrder: { type: Number, default: 0 },

    // --- Operating window (day-level windows live in AmenityAvailability) ---
    openingTime: { type: String, default: "06:00" }, // "HH:mm", society-local
    closingTime: { type: String, default: "22:00" },
    operatingDays: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] }, // 0 = Sun

    // --- Status ---
    status: { type: String, enum: AMENITY_STATUSES, default: AMENITY_STATUS.OPEN, index: true },
    statusNote: { type: String, trim: true, maxlength: 300 },
    statusChangedAt: { type: Date },
    statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // --- Configuration blocks ---
    access: { type: AccessSchema, default: () => ({}) },
    capacity: { type: CapacitySchema, default: () => ({}) },
    slotPolicy: { type: SlotPolicySchema, default: () => ({}) },
    visitorPolicy: { type: VisitorPolicySchema, default: () => ({}) },

    attendanceMode: { type: String, enum: ATTENDANCE_MODES, default: ATTENDANCE_MODE.NONE, index: true },

    // --- Live state ---
    // Atomically maintained by AttendanceService via $inc guarded on
    // maxOccupancy. This is what makes capacity enforcement concurrency-safe
    // without a transaction: the filter and the increment are one operation.
    liveOccupancy: { type: Number, default: 0, min: 0 },
    // Set while a maintenance window is active so residents get an accurate
    // banner without a second query.
    activeMaintenanceId: { type: mongoose.Schema.Types.ObjectId, ref: "AmenityMaintenance", default: null },

    // Per-amenity overrides of the society feature flags. Sparse by design:
    // only keys the admin explicitly set appear here.
    featureOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

AmenitySchema.index(
  { societyId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
AmenitySchema.index({ societyId: 1, categoryId: 1, displayOrder: 1 });
AmenitySchema.index({ societyId: 1, isActive: 1, status: 1 });

export default mongoose.models.Amenity ||
  mongoose.model("Amenity", AmenitySchema, "amenities");
