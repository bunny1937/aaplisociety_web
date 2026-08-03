import mongoose from "mongoose";

/**
 * Holds a parsed-but-not-yet-committed import (members or bills) between the
 * preview click and the confirm click.
 *
 * ## Why Mongo, not a temp file or in-memory cache
 *
 * The old flow wrote the uploaded workbook to disk (`writeFile` into a
 * `temp/` folder) and had `confirm-import` read it back by path. That is
 * broken on Vercel: the filesystem outside `/tmp` is read-only, and even
 * `/tmp` does not survive across the two separate invocations preview and
 * confirm land on - a serverless function can be frozen or recycled while an
 * admin is still looking at the preview grid.
 *
 * Staging the *parsed rows* here instead means confirm needs only the
 * `stagingId`, works regardless of which instance handles which request, and
 * never re-parses the workbook a second time.
 *
 * `expiresAt` gives a 1-hour TTL so an abandoned preview cannot accumulate.
 * `consumedAt` makes confirm atomic and single-use via
 * `findOneAndUpdate({ consumedAt: null }, { $set: { consumedAt: ... } })` -
 * a double-submit races the same document, and only one request can win.
 */
const ImportStagingSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    kind: { type: String, enum: ["members", "bills"], required: true },
    fileHash: { type: String, required: true },
    fileName: String,
    rowCount: { type: Number, default: 0 },
    rows: { type: mongoose.Schema.Types.Mixed, default: [] },
    validation: { type: mongoose.Schema.Types.Mixed, default: {} },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 60 * 60 * 1000) },
  },
  { timestamps: true },
);

// Repeat-upload short-circuit: same society, same kind, same file content,
// still unconsumed.
ImportStagingSchema.index({ societyId: 1, kind: 1, fileHash: 1, consumedAt: 1 });
ImportStagingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.ImportStaging ||
  mongoose.model("ImportStaging", ImportStagingSchema);
