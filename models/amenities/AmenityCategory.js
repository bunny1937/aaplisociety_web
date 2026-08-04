import mongoose from "mongoose";

// amenity_categories — society-authored grouping for amenities. Unlimited,
// with no seeded list: "Sports"/"Wellness"/"Kids" are examples in the brief,
// not an enum, because a township's taxonomy is its own business.
const AmenityCategorySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true, index: true },
    displayOrder: { type: Number, default: 0 },
    // Denormalised counter kept in step by AmenityService. Cheap to maintain
    // and it saves a per-category count() on every list render.
    amenityCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

// One category name per society. Partial so soft-deleted rows do not block
// re-creating a category with the same name.
AmenityCategorySchema.index(
  { societyId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);
AmenityCategorySchema.index({ societyId: 1, isActive: 1, displayOrder: 1 });

export default mongoose.models.AmenityCategory ||
  mongoose.model("AmenityCategory", AmenityCategorySchema, "amenity_categories");
