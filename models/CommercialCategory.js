import mongoose from "mongoose";
import {
  CATEGORY_SCOPES,
  CATEGORY_SCOPE_VALUES,
  COMMERCIAL_SCHEMA_VERSION,
  UPDATE_REASONS,
} from "@/lib/commercial/constants";

// Reusable platform defaults (GLOBAL) + per-society additions (SOCIETY).
// Global rows are NOT copied into each society: a directory read is
// GLOBAL(active) + SOCIETY(active, this society only).
const CommercialCategorySchema = new mongoose.Schema(
  {
    schemaVersion: { type: Number, required: true, default: COMMERCIAL_SCHEMA_VERSION },
    scope: {
      type: String,
      enum: CATEGORY_SCOPE_VALUES,
      required: true,
      default: CATEGORY_SCOPES.SOCIETY,
    },
    // null for GLOBAL rows.
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    sortOrder: { type: Number, default: 100 },
    isActive: { type: Boolean, default: true },

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

CommercialCategorySchema.index({ scope: 1, societyId: 1, isActive: 1, sortOrder: 1 });
// One active slug per scope. Partial indexes keep deleted rows out of the way.
CommercialCategorySchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: CATEGORY_SCOPES.GLOBAL, isDeleted: false },
  },
);
CommercialCategorySchema.index(
  { societyId: 1, slug: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: CATEGORY_SCOPES.SOCIETY, isDeleted: false },
  },
);

export default mongoose.models.CommercialCategory ||
  mongoose.model("CommercialCategory", CommercialCategorySchema);
