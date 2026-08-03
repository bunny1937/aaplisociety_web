import mongoose from "mongoose";

// One row per (society, policy, night). Written by /v1/cron/retention-export,
// read by /v1/cron/retention-purge.
//
// This is the contract between the two jobs. The purge job deletes NOTHING
// that does not have a matching, verified row here — that is the whole safety
// property. Archive and delete deliberately live in two different
// invocations, an hour apart, so a silent R2 or SMTP failure can never take
// the data with it.
const RetentionArchiveSchema = new mongoose.Schema(
  {
    policyId: { type: String, required: true, index: true },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    societyName: { type: String },

    // The window that was archived.
    cutoff: { type: Date, required: true },
    runDate: { type: String, required: true }, // YYYY-MM-DD, IST

    // Exactly which documents this bundle covers. The purge job deletes by
    // this list and nothing else — never by a re-run of the original query,
    // which could match rows created after the export.
    docIds: [{ type: mongoose.Schema.Types.ObjectId }],
    recordCount: { type: Number, required: true },

    // R2 object holding the zip of all five formats.
    r2Key: { type: String },
    r2Size: { type: Number },
    sha256: { type: String },
    formats: [{ type: String }],

    // Delivery.
    emailTo: [{ type: String }],
    emailSentAt: { type: Date },
    emailError: { type: String },

    status: {
      type: String,
      enum: ["exporting", "exported", "delivered", "purged", "failed"],
      default: "exporting",
      index: true,
    },
    error: { type: String },

    purgedAt: { type: Date },
    purgedCount: { type: Number, default: 0 },

    // The archive metadata itself is small; keep it far longer than the data
    // it describes so you can always answer "what happened to those rows".
    willExpireAt: {
      type: Date,
      default: () => new Date(Date.now() + 400 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

RetentionArchiveSchema.index({ willExpireAt: 1 }, { expireAfterSeconds: 0 });
// One bundle per policy per society per night — makes the export job safely
// re-runnable if the scheduler retries it.
RetentionArchiveSchema.index(
  { policyId: 1, societyId: 1, runDate: 1 },
  { unique: true },
);
RetentionArchiveSchema.index({ status: 1, emailSentAt: 1 });

export default mongoose.models.RetentionArchive ||
  mongoose.model("RetentionArchive", RetentionArchiveSchema);
