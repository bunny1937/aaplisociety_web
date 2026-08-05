import mongoose from "mongoose";
import { COMMERCIAL_SCHEMA_VERSION } from "@/lib/commercial/constants";

// Shop/Office rate table only — NEVER a residential column, so there is no
// shared-state ambiguity with models/BillingHead.js. See
// docs/superpowers/specs/2026-08-05-commercial-billing-separation-design.md.
const CommercialBillingHeadSchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, required: true, default: COMMERCIAL_SCHEMA_VERSION },
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    headName: { type: String, required: true, trim: true, maxlength: 120 },
    categoryScope: {
      type: [{ type: String, enum: ["Shop", "Office"] }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "categoryScope must include at least one of Shop, Office",
      },
    },
    calculationType: {
      type: String,
      enum: ["Fixed", "Per Sq Ft", "Percentage"],
      required: true,
    },
    rate: {
      type: new mongoose.Schema(
        {
          Shop: { type: Number, min: 0, default: null },
          Office: { type: Number, min: 0, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    isServiceCharge: { type: Boolean, default: false },
    nonOccupancyEligible: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deleteReason: { type: String, trim: true, maxlength: 200, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedReason: { type: String, trim: true, maxlength: 80, default: null },
  },
  { timestamps: true },
);

CommercialBillingHeadSchema.index({ societyId: 1, isDeleted: 1, isActive: 1 });
CommercialBillingHeadSchema.index({ societyId: 1, headName: 1 }, { unique: true });

export default mongoose.models.CommercialBillingHead ||
  mongoose.model("CommercialBillingHead", CommercialBillingHeadSchema);
