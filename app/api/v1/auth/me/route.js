import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { User, Member, Society } from "@/lib/v1/models";
import { toMemberDto, toSocietyDto } from "@/lib/v1/authService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(async (req) => {
  const claims = getClaims(req, { allowMustChange: true });
  const user = await User.findById(claims.userId).select("-password -passwordHash -resetCodeHash");
  if (!user) throw new ApiError(401, "User not found");

  const [member, society] = await Promise.all([
    claims.memberId ? Member.findById(claims.memberId) : Promise.resolve(null),
    claims.societyId ? Society.findById(claims.societyId) : Promise.resolve(null),
  ]);

  return json({
    user: {
      _id: String(user._id),
      username: user.username,
      email: user.email ?? null,
      role: claims.role,
      mustChangePassword: user.mustChangePassword === true,
    },
    claims: {
      userId: claims.userId,
      role: claims.role,
      societyId: claims.societyId ?? null,
      memberId: claims.memberId ?? null,
      activeProfileId: claims.activeProfileId ?? null,
      occupancyType: claims.occupancyType ?? null,
    },
    member: toMemberDto(member),
    society: toSocietyDto(society),
  });
});
