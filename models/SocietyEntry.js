import mongoose from "mongoose";

const SocietyEntrySchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    fy: { type: Number, required: true }, // e.g. 2025 = FY 2025-26
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["Maintenance", "Sinking Fund", "Repair & Maintenance", "Other Income", "Other Expense", "Auditor Fees", "Legal Fees", "Utilities", "Custom"],
      default: "Custom",
    },
    entryKind: { type: String, enum: ["income", "expenditure"], required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

SocietyEntrySchema.index({ societyId: 1, fy: 1 });

export default mongoose.models.SocietyEntry || mongoose.model("SocietyEntry", SocietyEntrySchema);
