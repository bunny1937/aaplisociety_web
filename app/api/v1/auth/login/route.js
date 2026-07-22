import bcrypt from "bcryptjs";
import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { loginSchema } from "@/lib/v1/schemas";
import { User } from "@/lib/v1/models";
import { issueTokens } from "@/lib/v1/authService";
import { signAccess } from "@/lib/v1/jwt";
import { enforceRateLimit } from "@/lib/v1/ratelimit";
import { OCCUPANCY_TYPES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyPassword(plain, user) {
  const hash = user.password || user.passwordHash;
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export const POST = withRoute(async (req) => {
  const commit = enforceRateLimit(req, "login", { windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true });
  const body = await req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const identifier = parsed.data.identifier.trim().toLowerCase();
  const { password } = parsed.data;

  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier }],
  });
  if (!user || !(await verifyPassword(password, user))) {
    throw new ApiError(401, "Invalid credentials");
  }
  if (user.isActive === false) throw new ApiError(403, "Account is disabled");

  const activeProfiles = (user.profiles || []).filter((p) => p.status === "Active");

  // Staff accounts without member profiles fall back to their root scope.
  if (activeProfiles.length === 0) {
    const result = await issueTokens(user, {
      role: user.role,
      societyId: user.societyId,
      memberId: user.memberId,
      occupancyType: OCCUPANCY_TYPES.OWNER,
    });
    commit(true);
    return json(result);
  }

  if (activeProfiles.length === 1) {
    const result = await issueTokens(user, activeProfiles[0]);
    commit(true);
    return json(result);
  }

  // Multiple profiles → client must choose one via /auth/switch-profile.
  const selectToken = signAccess({ userId: String(user._id), role: user.role, pending: true });
  commit(true);
  return json({
    needsProfileSelect: true,
    selectToken,
    profiles: activeProfiles.map((p) => ({
      profileId: String(p.profileId ?? p._id),
      societyName: p.societyName ?? null,
      flatNo: p.flatNo ?? null,
    })),
  });
});
