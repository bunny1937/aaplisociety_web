import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { profileSelectSchema } from "@/lib/v1/schemas";
import { User } from "@/lib/v1/models";
import { issueTokens } from "@/lib/v1/authService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req) => {
  // The selectToken issued by /auth/login is a pending token.
  const claims = getClaims(req, { allowPending: true });
  if (!claims.pending) throw new ApiError(400, "Profile already selected");
  const body = await req.json().catch(() => ({}));
  const parsed = profileSelectSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const user = await User.findById(claims.userId);
  if (!user) throw new ApiError(401, "User not found");
  const profile = (user.profiles || []).find(
    (p) => String(p.profileId ?? p._id) === parsed.data.profileId && p.status === "Active",
  );
  if (!profile) throw new ApiError(404, "Profile not found");

  return json(await issueTokens(user, profile));
});
