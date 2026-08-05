import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import { User, Member, Society } from "@/lib/v1/models";
import { toMemberDto, toSocietyDto } from "@/lib/v1/authService";
import { normalizeCommercialFlags } from "@/lib/commercial/featureFlags";
import { isCommercialUnit } from "@/lib/commercial/constants";
import BusinessProfile from "@/models/BusinessProfile";

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
  // Commercial capabilities (ADDITIVE). Existing keys are untouched: the app
  // stays on the same role and the same shell. An older build ignores these
  // two booleans; a newer build uses them to show or hide the shop directory
  // without an app release.
  const commercialFlags = normalizeCommercialFlags(society?.features);
  const ownsCommercialUnit = commercialFlags.enabled && isCommercialUnit(member);
  let businessProfile = null;
  if (ownsCommercialUnit) {
    const bp = await BusinessProfile.findOne({
      societyId: claims.societyId,
      memberId: claims.memberId,
      isDeleted: { $ne: true },
    })
      .select("tradeName visibilityStatus mediaVersion logoKey")
      .lean()
      .catch(() => null);
    if (bp) {
      businessProfile = {
        id: String(bp._id),
        tradeName: bp.tradeName,
        visibilityStatus: bp.visibilityStatus,
        logoKey: bp.logoKey ?? null,
        mediaVersion: bp.mediaVersion ?? 0,
      };
    }
  }

  return json({
    capabilities: {
      commercialDirectory: commercialFlags.directoryEnabled === true,
      manageBusinessProfile:
        ownsCommercialUnit && commercialFlags.ownerEditingEnabled === true,
    },
    businessProfile,
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