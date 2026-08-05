import mongoose from "mongoose";

// One doc per {societyId, periodKey, series}. lastNumber is allocated ONLY
// via $inc in a single findOneAndUpdate (see lib/commercial/billNumbering.js)
// — never read-then-write, so concurrent generation can never double-issue a
// number. periodKey = "YYYY-MM"; resets the counter every month by design.
const CommercialNumberSequenceSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true },
    periodKey: { type: String, required: true }, // "2026-08"
    series: { type: String, enum: ["BILL", "RECEIPT"], required: true },
    lastNumber: { type: Number, default: 0 },
  },
  { timestamps: true },
);

CommercialNumberSequenceSchema.index(
  { societyId: 1, periodKey: 1, series: 1 },
  { unique: true },
);

export default mongoose.models.CommercialNumberSequence ||
  mongoose.model("CommercialNumberSequence", CommercialNumberSequenceSchema);
