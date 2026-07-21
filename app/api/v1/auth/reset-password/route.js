import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { resetPasswordSchema } from "@/lib/v1/schemas";
import { User, RefreshToken } from "@/lib/v1/models";
import { enforceRateLimit } from "@/lib/v1/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256(v) {
  return crypto.createHash("sha256").update(v).digest("hex");
}

export const POST = withRoute(async (req) => {
  enforceRateLimit(req, "reset-password", { windowMs: 15 * 60 * 1000, limit: 10 });
  const body = await req.json().catch(() => ({}));
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const { identifier, code, newPassword } = parsed.data;

  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
  });
  if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt) {
    throw new ApiError(400, "Invalid or expired reset code");
  }
  if (new Date(user.resetCodeExpiresAt).getTime() < Date.now()) {
    throw new ApiError(400, "Reset code has expired");
  }
  if ((user.resetCodeAttempts ?? 0) >= 5) {
    throw new ApiError(429, "Too many attempts. Request a new code.");
  }
  if (sha256(code) !== user.resetCodeHash) {
    user.resetCodeAttempts = (user.resetCodeAttempts ?? 0) + 1;
    await user.save();
    throw new ApiError(400, "Invalid or expired reset code");
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  user.resetCodeHash = undefined;
  user.resetCodeExpiresAt = undefined;
  user.resetCodeAttempts = 0;
  await user.save();
  await RefreshToken.updateMany({ userId: user._id, revoked: false }, { $set: { revoked: true } });

  return json({ ok: true });
});
