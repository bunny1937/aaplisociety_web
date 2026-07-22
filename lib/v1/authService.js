// Token issuance for the /v1 auth flow. Ported from mobile-backend
// src/modules/auth/auth.controller.ts issueTokens() + its DTO helpers.
import { randomUUID } from "node:crypto";
import { signAccess, signRefresh, refreshExpiresAt } from "./jwt";
import { RefreshToken } from "./models";
import { OCCUPANCY_TYPES } from "./constants";

// Builds JWT claims from the user + selected profile, mints a rotating
// refresh token (persisted for revocation), and returns the login/refresh
// response shape the Flutter client expects: { role, mustChangePassword,
// tokens: { accessToken, refreshToken } }.
export async function issueTokens(user, profile) {
  const claims = {
    userId: String(user._id),
    role: profile?.role ?? user.role,
    societyId: profile?.societyId ? String(profile.societyId) : undefined,
    memberId: profile?.memberId ? String(profile.memberId) : undefined,
    // Web User profiles use `profileId` (auto ObjectId); guard for staff
    // accounts whose fallback profile has neither profileId nor _id.
    activeProfileId: profile?.profileId
      ? String(profile.profileId)
      : profile?._id
        ? String(profile._id)
        : undefined,
    occupancyType: profile?.occupancyType ?? OCCUPANCY_TYPES.OWNER,
    mustChangePassword: user.mustChangePassword === true || undefined,
  };
  const jti = randomUUID();
  // Carry the active profile in the refresh token so /auth/refresh can
  // re-scope the rotated access token to the same profile statelessly.
  const refreshToken = signRefresh({ userId: String(user._id), jti, profileId: claims.activeProfileId });
  await RefreshToken.create({ userId: user._id, jti, expiresAt: refreshExpiresAt(refreshToken) });
  return {
    role: claims.role,
    mustChangePassword: claims.mustChangePassword,
    tokens: { accessToken: signAccess(claims), refreshToken },
  };
}

// Mint a fresh access+refresh pair carrying the SAME scope (role/society/
// member/profile) as an existing verified access token, but with an updated
// mustChangePassword claim. Used right after a password change: the old
// access token still has mustChangePassword baked in and stays valid (by
// signature) until it naturally expires, so every route kept 403'ing
// "Password change required" even though the DB was already updated. The
// client must swap to this new pair immediately instead of waiting out the
// old token's TTL.
export async function reissueTokens(oldClaims, user) {
  const jti = randomUUID();
  const claims = {
    userId: oldClaims.userId,
    role: oldClaims.role,
    societyId: oldClaims.societyId,
    memberId: oldClaims.memberId,
    activeProfileId: oldClaims.activeProfileId,
    occupancyType: oldClaims.occupancyType,
    mustChangePassword: user.mustChangePassword === true || undefined,
  };
  const refreshToken = signRefresh({
    userId: oldClaims.userId,
    jti,
    profileId: oldClaims.activeProfileId,
  });
  await RefreshToken.create({
    userId: user._id,
    jti,
    expiresAt: refreshExpiresAt(refreshToken),
  });
  return {
    role: claims.role,
    mustChangePassword: claims.mustChangePassword,
    tokens: { accessToken: signAccess(claims), refreshToken },
  };
}

// PII-safe Member projection for GET /v1/auth/me (never spread a raw Member
// doc — it carries PAN/Aadhaar/banking/history fields).
export function toMemberDto(m) {
  if (!m) return null;
  return {
    _id: String(m._id),
    ownerName: m.ownerName ?? null,
    flatNo: m.flatNo ?? null,
    wing: m.wing ?? null,
    flatType: m.flatType ?? null,
    ownershipType: m.ownershipType ?? null,
    carpetAreaSqft: m.carpetAreaSqft ?? null,
    builtUpAreaSqft: m.builtUpAreaSqft ?? null,
    hasVotingRights: m.hasVotingRights ?? null,
    contactNumber: m.contactNumber ?? null,
    whatsappNumber: m.whatsappNumber ?? null,
    parkingSlots: Array.isArray(m.parkingSlots)
      ? m.parkingSlots.map((p) => ({ slotNumber: p.slotNumber ?? null, type: p.type ?? null, vehicleType: p.vehicleType ?? null }))
      : [],
    familyMembers: Array.isArray(m.familyMembers)
      ? m.familyMembers.map((f) => ({ name: f.name ?? null, relation: f.relation ?? null, age: f.age ?? null }))
      : [],
  };
}

export function toSocietyDto(s) {
  if (!s) return null;
  return { _id: String(s._id), name: s.name ?? null, address: s.address ?? null };
}
