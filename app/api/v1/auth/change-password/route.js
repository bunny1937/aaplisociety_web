import bcrypt from "bcryptjs";
import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { changePasswordSchema } from "@/lib/v1/schemas";
import { User, RefreshToken } from "@/lib/v1/models";
import { reissueTokens } from "@/lib/v1/authService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req) => {
  const claims = getClaims(req, { allowMustChange: true });
  const body = await req.json().catch(() => ({}));
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const { currentPassword, newPassword } = parsed.data;

  const user = await User.findById(claims.userId);
  if (!user) throw new ApiError(401, "User not found");
  const hash = user.password || user.passwordHash;
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
    throw new ApiError(400, "Current password is incorrect");
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  await user.save();

  // Invalidate all existing sessions after a password change.
  await RefreshToken.updateMany({ userId: user._id, revoked: false }, { $set: { revoked: true } });

  // The token used to make THIS request still carries mustChangePassword:true
  // by signature and would keep getting 403'd everywhere else until it
  // naturally expires. Issue a fresh pair now so the client can swap
  // immediately instead of being stuck until TTL/refresh.
  const fresh = await reissueTokens(claims, user);

  return json({ ok: true, ...fresh });
});
