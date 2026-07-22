import mongoose from "mongoose";

// Stores uploaded binary files (bill/receipt templates, logos, signatures,
// visitor photos) directly in MongoDB. Vercel's serverless filesystem is
// read-only except for /tmp, so writing into public/uploads/... crashed with
// EROFS. Keeping the bytes in Mongo makes uploads work on serverless and
// survive redeploys.
const UploadedFileSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", index: true },
    kind: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.models.UploadedFile ||
  mongoose.model("UploadedFile", UploadedFileSchema);
