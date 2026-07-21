import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { User } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES, ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin/Secretary lookup of members in their society (used by guard-request /
// bill-create pickers in the app).
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  requireRoles(claims, SOCIETY_ADMIN_ROLES);
  const societyId = requireTenant(claims);

  const users = await User.find({
    role: ROLES.MEMBER,
    "profiles.societyId": societyId,
  }).select("username profiles");

  const members = [];
  for (const u of users) {
    for (const p of u.profiles || []) {
      if (String(p.societyId) === String(societyId) && p.status === "Active") {
        members.push({
          memberId: String(p.memberId ?? ""),
          username: u.username,
          flatNo: p.flatNo ?? null,
          wing: p.wing ?? null,
        });
      }
    }
  }

  return json({ members });
});
