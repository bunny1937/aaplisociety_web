import mongoose from "mongoose";
import { RULE_KINDS, RULE_KIND } from "@/lib/amenities/constants";

// amenity_rules — one row per rule / do / dont / instruction line.
//
// A row per line rather than four arrays on the amenity: it gives each line a
// stable id (so the resident app can deep-link "you violated rule #3"), an
// independent display order, and an audit trail of who added which line.
const AmenityRuleSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    amenityId: { type: mongoose.Schema.Types.ObjectId, ref: "Amenity", required: true, index: true },
    kind: { type: String, enum: RULE_KINDS, default: RULE_KIND.RULE, index: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    displayOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

AmenityRuleSchema.index({ amenityId: 1, kind: 1, displayOrder: 1 });

export default mongoose.models.AmenityRule ||
  mongoose.model("AmenityRule", AmenityRuleSchema, "amenity_rules");
