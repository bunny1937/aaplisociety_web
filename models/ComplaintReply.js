import mongoose from "mongoose";
const ComplaintReplySchema = new mongoose.Schema(
  {
    complaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      required: true,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorRole: {
      type: String,
      enum: ["Member", "Admin", "Secretary"],
      required: true,
    },
    // For member replies: shown as anonymous name from parent complaint
    // For admin replies: shown as "Society Admin"
    displayName: { type: String, required: true },
    message: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 1000,
    },
  },
  { timestamps: true },
);
ComplaintReplySchema.index({ complaintId: 1, createdAt: 1 });
export default mongoose.models.ComplaintReply ||
  mongoose.model("ComplaintReply", ComplaintReplySchema);
