import mongoose from "mongoose";

const ContextSchema = new mongoose.Schema({
  projectId: { type: String, required: true, unique: true },

  project: String,
  stack: String,
  currentIssue: String,
  notes: String,

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Context ||
  mongoose.model("Context", ContextSchema);