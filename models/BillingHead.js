import mongoose from "mongoose";
const BillingHeadSchema = new mongoose.Schema(
  {
    headName: {
      type: String,
      required: true,
      trim: true,
    },
    calculationType: {
      type: String,
      enum: ["Fixed", "Per Sq Ft", "Percentage"],
      required: true,
    },
    defaultAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Optional link to a Chart of Accounts Income account (Phase 2.7 of the
    // accounting-system revamp — docs/accounting-system-ARD.md §7). Lets a
    // posting rule map this specific billing head to its own income account
    // via the "billingHead:<id>" resolver key, instead of everything landing
    // in one generic maintenance-income account. Additive, optional, never
    // required — existing billing reads are unaffected.
    linkedAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    // Optional commercial applicability. MISSING or EMPTY = applies to every
    // unit, which is exactly today's behaviour for every existing head, so no
    // migration and no bill changes. Only a head an admin explicitly restricts
    // is filtered - see lib/commercial/billingApplicability.js.
    appliesToUnitClasses: {
      type: [{ type: String, enum: ["Residential", "Shop", "Office"] }],
      default: undefined,
    },
    // Optional per-unit-class RATE OVERRIDE. A shop and a flat can be charged
    // different amounts for the SAME head. MISSING or empty = every class pays
    // `defaultAmount`, which is exactly today's behaviour for every existing
    // head, so no migration and no bill changes until an admin sets a rate.
    unitClassRates: {
      type: new mongoose.Schema(
        {
          Residential: { type: Number, min: 0, default: undefined },
          Shop: { type: Number, min: 0, default: undefined },
          Office: { type: Number, min: 0, default: undefined },
        },
        { _id: false },
      ),
      default: undefined,
    },
    canBeArchived: { type: Boolean, default: false },
isDeleted: { type: Boolean, default: false },
deletedAt: { type: Date },
deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
lastModifiedAt: { type: Date },
lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    order: {
      type: Number,
      default: 0,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // Bulk-import provenance — see Society.importRunId
    importRunId: { type: String, default: null, index: true },
  },
  {
    timestamps: true,
  }
);
BillingHeadSchema.index({ societyId: 1, order: 1 });
BillingHeadSchema.index({ societyId: 1, headName: 1 }, { unique: true });
BillingHeadSchema.index({ societyId: 1, isDeleted: 1 });
export default mongoose.models.BillingHead ||
  mongoose.model("BillingHead", BillingHeadSchema);