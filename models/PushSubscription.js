// models/PushSubscription.js
// One row per browser/device that opted in to push. Linked to a member (resident)
// and/or a user, scoped by society.
import mongoose from "mongoose";
const PushSubscriptionSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", index: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);
export default mongoose.models.PushSubscription ||
  mongoose.model("PushSubscription", PushSubscriptionSchema);
