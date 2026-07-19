import mongoose from "mongoose";

// Mirrors apps/mobile-backend's RefreshToken model. A stored, revocable
// refresh token — previously this app had none: /api/auth/refresh just
// re-signed a new access token from any still-valid token, with no way to
// invalidate a specific session (e.g. on logout, or if a token leaked).
const RefreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jti: { type: String, required: true, unique: true },
    revoked: { type: Boolean, default: false },
    expiresAt: { type: Date, index: { expires: 0 } },
  },
  { timestamps: true },
);

export default mongoose.models.RefreshToken || mongoose.model("RefreshToken", RefreshTokenSchema);
