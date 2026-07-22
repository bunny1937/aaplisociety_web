import mongoose from "mongoose";

// Durable, idempotent email queue. Rows are created in the same finalization
// step as the data they describe (after core DB commit), then processed
// separately — a failed send never corrupts or rolls back real data, and the
// unique key prevents ever re-sending the same email on retry.
const EmailOutboxSchema = new mongoose.Schema(
  {
    importRunId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true }, // e.g. "onboarding"
    to: { type: String, required: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true },
);
// Idempotency: same import + same user + same email type can only ever
// produce one outbox row, so a retried finalize step can't queue a duplicate.
EmailOutboxSchema.index(
  { importRunId: 1, userId: 1, type: 1 },
  { unique: true },
);
export default mongoose.models.EmailOutbox ||
  mongoose.model("EmailOutbox", EmailOutboxSchema);
