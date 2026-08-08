import mongoose from "mongoose";

// models/CommercialSettings.js
//
// NEW 2026-08-07. One row per society. This is what the Rate Card page edits
// besides the individual charge heads.
//
// Everything here was previously HARDCODED somewhere in the codebase: the 21%
// interest, the 10% non-occupancy cap, the Rs 7,500 GST threshold, whether a
// business profile was needed. Hardcoded numbers are why the rate card could
// not answer "what will this shop be charged" — half the answer wasn't on the
// page.

const CommercialSettingsSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      unique: true,
      index: true,
    },

    // ---- GST (society decides) ------------------------------------------
    gst: {
      mode: {
        type: String,
        enum: [
          "None", // society is not GST registered
          "Always", // charge on every commercial bill
          "AboveThreshold", // CBIC Circular 109/28/2019 style exemption
        ],
        default: "None",
      },
      ratePercent: { type: Number, min: 0, max: 50, default: 18 },
      // Only meaningful when mode = "AboveThreshold".
      thresholdPerUnitPerMonth: { type: Number, min: 0, default: 7500 },
      societyGstin: { type: String, trim: true, uppercase: true, maxlength: 15, default: null },
      // Whether the threshold is tested on the whole bill or only on the heads
      // marked as service charges.
      thresholdBasis: {
        type: String,
        enum: ["ServiceChargesOnly", "WholeBill"],
        default: "ServiceChargesOnly",
      },
    },

    // ---- Interest on overdue (rate card decides, default 21%) -----------
    interest: {
      enabled: { type: Boolean, default: true },
      annualRatePercent: { type: Number, min: 0, max: 100, default: 21 },
      method: { type: String, enum: ["SIMPLE", "COMPOUND"], default: "SIMPLE" },
      graceDays: { type: Number, min: 0, max: 90, default: 0 },
    },

    // ---- Non-occupancy (rented-out units) -------------------------------
    // Q: checkbox to enable; if enabled, applies to which; if commercial, how
    // it is calculated and at what value.
    nonOccupancy: {
      enabled: { type: Boolean, default: false },
      appliesTo: {
        type: String,
        enum: ["Residential", "Commercial", "Both"],
        default: "Both",
      },
      commercial: {
        method: { type: String, enum: ["Percent", "Rupees"], default: "Percent" },
        value: { type: Number, min: 0, default: 10 },
        // Bombay HC (Mar 2007) / Maharashtra GR (Aug 2001) cap non-occupancy at
        // 10% of service charges for co-operative housing societies. Kept as a
        // setting rather than a constant, but defaulted to the lawful figure.
        capPercentOfServiceCharges: { type: Number, min: 0, max: 100, default: 10 },
      },
    },

    // ---- Electricity ------------------------------------------------------
    // Default: shops pay their own bill, so the society bills nothing.
    // Opt-in: common meter with sub-meter recovery.
    electricity: {
      societyManagedEnabled: { type: Boolean, default: false },
      ratePerUnit: { type: Number, min: 0, default: 0 },
      fixedMonthlyCharge: { type: Number, min: 0, default: 0 },
      // Recovery is only attempted for shops whose own electricityMode is
      // "Society-managed sub-meter".
      requireMeterReading: { type: Boolean, default: true },
    },

    // ---- Funds -------------------------------------------------------------
    // Same heads as residential, but the society enters its own figures rather
    // than inheriting the residential ones.
    funds: {
      sinking: {
        enabled: { type: Boolean, default: true },
        method: { type: String, enum: ["PerSqFt", "Percent", "Fixed"], default: "PerSqFt" },
        value: { type: Number, min: 0, default: 0.25 },
      },
      repair: {
        enabled: { type: Boolean, default: true },
        method: { type: String, enum: ["PerSqFt", "Percent", "Fixed"], default: "PerSqFt" },
        value: { type: Number, min: 0, default: 0.75 },
      },
    },

    // ---- Policy switches ---------------------------------------------------
    // "Let the rate card page choose to enable or disable" — whether a shop
    // must have its trade details filled before it can be billed.
    requireBusinessProfileBeforeBilling: { type: Boolean, default: false },

    // Separate bill numbering for commercial, e.g. C-2026-08-103.
    billNumberPrefix: { type: String, trim: true, maxlength: 6, default: "C" },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Reading settings must never fail just because a society has not opened the
// rate card yet. Callers get the documented defaults instead.
CommercialSettingsSchema.statics.getOrDefaults = async function (societyId) {
  const found = await this.findOne({ societyId }).lean();
  if (found) return found;
  return new this({ societyId }).toObject();
};

export default mongoose.models.CommercialSettings ||
  mongoose.model("CommercialSettings", CommercialSettingsSchema);
