import mongoose from "mongoose";
import {
  COMMERCIAL_SCHEMA_VERSION,
  FULFILLMENT_MODES,
  UPDATE_REASONS,
  VISIBILITY_STATUS,
  VISIBILITY_STATUS_VALUES,
} from "@/lib/commercial/constants";

// Business-specific directory information ONLY.
//
// It deliberately stores no ownership, tenancy, login, bill, balance, receipt
// or accounting data: Member owns the unit, User owns the login, the existing
// billing/accounting engines own the money. The link to everything else is
// `memberId` — the same id bills, receipts and profiles already use.

const IntervalSchema = new mongoose.Schema(
  {
    opensAt: { type: String, required: true }, // "HH:mm", 24h
    closesAt: { type: String, required: true },
  },
  { _id: false },
);

const DayScheduleSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    isClosed: { type: Boolean, default: false },
    intervals: { type: [IntervalSchema], default: [] },
  },
  { _id: false },
);

const ExceptionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // "YYYY-MM-DD"
    label: { type: String, trim: true },
    isClosed: { type: Boolean, default: true },
    intervals: { type: [IntervalSchema], default: [] },
  },
  { _id: false },
);

// Normalized from day one so holidays/exceptions never need a migration.
const BusinessHoursSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, default: COMMERCIAL_SCHEMA_VERSION },
    timezone: { type: String, default: "Asia/Kolkata" },
    weeklySchedule: { type: [DayScheduleSchema], default: [] },
    exceptions: { type: [ExceptionSchema], default: [] },
  },
  { _id: false },
);

const BusinessProfileSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, required: true, default: COMMERCIAL_SCHEMA_VERSION },

    // Tenant scope + unit link. Both required: every query is compound-scoped.
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // The EXISTING unit record. Not a new property model.
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
    },

    tradeName: { type: String, required: true, trim: true, maxlength: 120 },
    legalName: { type: String, trim: true, maxlength: 160 },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommercialCategory",
      required: true,
    },
    description: { type: String, trim: true, maxlength: 2000 },

    phone: { type: String, trim: true, maxlength: 20 },
    whatsapp: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },

    gstin: { type: String, trim: true, uppercase: true, maxlength: 15 },
    licenseNumber: { type: String, trim: true, maxlength: 60 },

    // ADDED 2026-08-07 — real shop onboarding.
    //
    // Setting up a shop used to capture name + category + opening hours only,
    // which is a directory listing, not a commercial unit. None of the things a
    // society actually needs to bill and govern a shop were asked for. These are
    // the ones that matter in practice in an Indian society.
    //
    // NOTE ON AREA: the billable carpet area still lives on Member.carpetAreaSqft
    // — that is the single field the billing engine reads, and duplicating it
    // here would guarantee the two drift apart. The shop form now asks for it and
    // writes it to the Member record (see businessProfileService.js).
    shopActNumber: { type: String, trim: true, maxlength: 60 },   // Gumasta
    fssaiNumber: { type: String, trim: true, maxlength: 20 },     // food businesses

    // Who physically occupies the unit. Drives the non-occupancy charge
    // conversation — the charge itself stays a deliberate admin toggle below.
    occupancyType: {
      type: String,
      enum: ["Self-occupied", "Rented out", "Vacant"],
      default: "Self-occupied",
    },
    tenantName: { type: String, trim: true, maxlength: 120 },
    tenantPhone: { type: String, trim: true, maxlength: 20 },
    leaseStartDate: { type: String, trim: true, maxlength: 10 },  // YYYY-MM-DD
    leaseEndDate: { type: String, trim: true, maxlength: 10 },

    // Premises facts the committee is asked for constantly.
    floor: { type: String, trim: true, maxlength: 20 },           // "Ground", "1st"
    shutterCount: { type: Number, min: 0, max: 20, default: null },
    hasSignage: { type: Boolean, default: false },
    signageSizeSqft: { type: Number, min: 0, max: 10000, default: null },
    electricityMeterNo: { type: String, trim: true, maxlength: 40 },
    waterConnectionNo: { type: String, trim: true, maxlength: 40 },
    emergencyContactName: { type: String, trim: true, maxlength: 120 },
    emergencyContactPhone: { type: String, trim: true, maxlength: 20 },

    businessHours: { type: BusinessHoursSchema, default: null },

    // R2 object keys only — never public URLs, never raw bytes.
    logoKey: { type: String, default: null },
    coverKey: { type: String, default: null },
    // Bumped on every media replacement so clients refresh cached images.
    mediaVersion: { type: Number, default: 0 },

    fulfillmentModes: {
      type: [{ type: String, enum: FULFILLMENT_MODES }],
      default: [],
    },

    // Manual admin toggle — NOT auto-derived from occupancyType. Ticking this
    // adds a non-occupancy line (capped 10% of service-charge heads) to this
    // unit's commercial bills. See lib/commercial/commercialChargeEngine.js.
    nonOccupancyCharged: { type: Boolean, default: false },

    visibilityStatus: {
      type: String,
      enum: VISIBILITY_STATUS_VALUES,
      default: VISIBILITY_STATUS.DRAFT,
      required: true,
    },

    // Soft delete only.
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deleteReason: { type: String, trim: true, maxlength: 200, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedReason: { type: String, enum: UPDATE_REASONS, default: null },
  },
  { timestamps: true },
);

// One active business per unit; every read path is society-scoped first.
BusinessProfileSchema.index({ societyId: 1, memberId: 1 }, { unique: true });
BusinessProfileSchema.index({ societyId: 1, visibilityStatus: 1, categoryId: 1 });
BusinessProfileSchema.index({ societyId: 1, tradeName: 1 });
BusinessProfileSchema.index({ societyId: 1, isDeleted: 1 });

export default mongoose.models.BusinessProfile ||
  mongoose.model("BusinessProfile", BusinessProfileSchema);
