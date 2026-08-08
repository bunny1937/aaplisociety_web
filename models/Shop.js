import mongoose from "mongoose";

// models/Shop.js
//
// NEW 2026-08-07. A shop is its OWN record. It is not a Member with
// flatType: "Shop".
//
// WHY THIS EXISTS
// ---------------
// The previous approach classified a unit as commercial by OVERWRITING
// Member.flatType to "Shop". That was destructive and it is exactly what went
// wrong with A-103: it was a flat, it was marked as a shop, and its residential
// identity was gone. There was no "also" — only "instead". A member cannot be a
// flat and a shop at the same time when the same field encodes both.
//
// A shop now:
//   - has its OWN area (`areaSqft`), never borrowed from a flat
//   - LINKS to an owner, optionally, without changing anything on that record
//   - can exist with no member at all (non-resident shopkeeper), which is the
//     stated requirement for later
//
// Deleting a shop therefore cannot damage a flat, and marking a flat's shop
// inactive cannot stop the flat being billed residentially.

const ShopSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },

    // ---- Identity -------------------------------------------------------
    // Its own address within the society. A shop may sit at the same street
    // position as a flat and must still be addressable separately.
    shopNo: { type: String, required: true, trim: true, maxlength: 20 },
    wing: { type: String, trim: true, maxlength: 20, default: null },
    floor: { type: Number, min: -3, max: 150, default: 0 },

    unitKind: {
      type: String,
      enum: ["Shop", "Office"],
      required: true,
      default: "Shop",
    },

    // ---- Ownership link (OPTIONAL BY DESIGN) ----------------------------
    // Exactly one of these may be set, or neither.
    //   ownerMemberId -> a society member also owns this shop
    //   ownerUserId   -> an outside party owns it (future non-resident case)
    //   neither       -> recorded against a plain name only
    //
    // Setting ownerMemberId writes NOTHING to that Member. It is a reference,
    // not a reclassification.
    ownerMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      default: null,
      index: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // Always populated so a bill can be addressed even with no link at all.
    ownerName: { type: String, required: true, trim: true, maxlength: 160 },
    ownerPhone: { type: String, trim: true, maxlength: 20, default: null },
    ownerEmail: { type: String, trim: true, lowercase: true, maxlength: 160, default: null },

    // ---- Area: the shop's OWN figure ------------------------------------
    // Deliberately ONE number, not carpet/built-up/super. Commercial rent and
    // society charges in Indian markets are quoted on a single agreed figure,
    // and three fields is precisely what made the flat side ambiguous.
    // `areaBasisNote` records what that figure represents, for the record only
    // — it never changes the arithmetic.
    areaSqft: {
      type: Number,
      required: true,
      min: 1,
      max: 1000000,
    },
    areaBasisNote: {
      type: String,
      enum: ["Carpet", "Built-up", "Super built-up", "Agreed/Other"],
      default: "Carpet",
    },

    // ---- Occupancy -------------------------------------------------------
    occupancyType: {
      type: String,
      enum: ["Owner-Occupied", "Rented out", "Vacant"],
      default: "Owner-Occupied",
    },
    tenantName: { type: String, trim: true, maxlength: 160, default: null },
    tenantPhone: { type: String, trim: true, maxlength: 20, default: null },
    leaseStartDate: { type: Date, default: null },
    leaseEndDate: { type: Date, default: null },

    // ---- Trade details ---------------------------------------------------
    tradeName: { type: String, trim: true, maxlength: 160, default: null },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessCategory",
      default: null,
    },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15, default: null },
    shopActNumber: { type: String, trim: true, maxlength: 40, default: null },
    fssaiNumber: { type: String, trim: true, maxlength: 20, default: null },

    // ---- Utilities -------------------------------------------------------
    // Default is that the shop pays its own electricity bill directly, which is
    // the common arrangement. Society-managed sub-meter recovery is opt-in per
    // shop and only applies when the society has enabled it on the rate card.
    electricityMode: {
      type: String,
      enum: ["Own connection", "Society-managed sub-meter"],
      default: "Own connection",
    },
    electricityMeterNo: { type: String, trim: true, maxlength: 40, default: null },
    lastMeterReading: { type: Number, min: 0, default: null },
    lastMeterReadingDate: { type: Date, default: null },

    waterConnectionNo: { type: String, trim: true, maxlength: 40, default: null },
    shutterCount: { type: Number, min: 0, max: 50, default: 1 },
    hasSignage: { type: Boolean, default: false },
    signageSizeSqft: { type: Number, min: 0, default: null },

    emergencyContactName: { type: String, trim: true, maxlength: 120, default: null },
    emergencyContactPhone: { type: String, trim: true, maxlength: 20, default: null },

    // ---- Commercial ledger openings -------------------------------------
    // A shop's dues are ITS OWN. The A-103 bug was the commercial run
    // inheriting the flat's Rs 1,335 residential opening balance. These fields
    // exist so the commercial ledger can never again read a Member's.
    openingPrincipal: { type: Number, default: 0, min: 0 },
    openingInterest: { type: Number, default: 0, min: 0 },

    // ---- Billing state ---------------------------------------------------
    isBillable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// A shop number is unique within a society, among live records only, so a
// deleted shop's number can be reused.
ShopSchema.index(
  { societyId: 1, wing: 1, shopNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
ShopSchema.index({ societyId: 1, isDeleted: 1, isActive: 1 });
ShopSchema.index({ societyId: 1, ownerMemberId: 1 });

// Label used on bills and screens: "A-103 (Shop)" or "103 (Shop)".
ShopSchema.virtual("unitLabel").get(function () {
  return [this.wing, this.shopNo].filter(Boolean).join("-");
});

ShopSchema.pre("save", function (next) {
  // A shop cannot be owned by a member AND an outside user at once.
  if (this.ownerMemberId && this.ownerUserId) {
    return next(
      new Error("A shop can be linked to a member or an outside owner, not both."),
    );
  }
  // Rented out with no tenant recorded is a data hole that surfaces later as a
  // wrong non-occupancy charge, so it is caught here.
  if (this.occupancyType === "Rented out" && !this.tenantName) {
    return next(new Error("Record the tenant's name for a shop marked as rented out."));
  }
  next();
});

export default mongoose.models.Shop || mongoose.model("Shop", ShopSchema);
