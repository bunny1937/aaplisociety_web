import { Member as V1Member } from "@/lib/v1/models";
import { ApiError } from "@/lib/v1/http";
import { CAPABILITY, can } from "./permissions";
import { capacitySnapshot } from "./attendanceService";

// Resolves the resident profile behind a mobile JWT.
//
// The app's token identifies a USER; amenity access decisions need the MEMBER
// (flat, owner/tenant, date of birth). Resolving that once per request keeps
// every /v1 amenity route from re-implementing the lookup and the failure modes.

export function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function clientIp(request) {
  const fwd = request?.headers?.get?.("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request?.headers?.get?.("x-real-ip") || "";
}

export async function memberContext(claims, request) {
  const societyId = claims?.societyId;
  if (!societyId) throw new ApiError(403, "Society context required");

  const query = claims.memberId
    ? { _id: claims.memberId, societyId }
    : { userId: claims.userId, societyId };

  const member = await V1Member.findOne(query)
    .select("_id name flatNo wing occupancyType dateOfBirth userId isActive")
    .lean();

  // Staff and committee accounts legitimately have no member profile. Only
  // resident-scoped routes call this, so the message points at the fix.
  if (!member) {
    throw new ApiError(403, "No resident profile is linked to this account. Please contact your society office.");
  }
  if (member.isActive === false) {
    throw new ApiError(403, "This resident profile is inactive.");
  }

  const flatLabel = [member.wing, member.flatNo].filter(Boolean).join("-") || member.flatNo || "";

  return {
    societyId,
    member,
    memberId: member._id,
    userId: claims.userId,
    role: claims.role,
    age: ageFrom(member.dateOfBirth),
    occupancyType: member.occupancyType,
    flatLabel,
    actor: {
      userId: claims.userId,
      name: member.name || "",
      role: claims.role || "",
      ip: clientIp(request),
      userAgent: request?.headers?.get?.("user-agent") || "",
    },
  };
}

export function requireCapability(ctx, capability) {
  if (!can(ctx.role, capability)) {
    throw new ApiError(403, "You do not have permission to do that.");
  }
}

// Resident-facing projection of an amenity.
//
// Residents never receive the raw document: internal counters, audit stamps and
// staff-only configuration stay server-side. Capacity is exposed as remaining
// space rather than raw occupancy plus limits.
export function publicAmenity(amenity, extra = {}) {
  return {
    _id: amenity._id,
    name: amenity.name,
    categoryId: amenity.categoryId,
    categoryName: amenity.categoryName || "",
    description: amenity.description || "",
    location: amenity.location || "",
    contactPersonName: amenity.contactPerson?.name || "",
    contactPersonPhone: amenity.contactPerson?.phone || "",
    status: amenity.status,
    statusNote: amenity.statusNote || "",
    operatingDays: amenity.operatingDays || [],
    openingTime: amenity.openingTime,
    closingTime: amenity.closingTime,
    attendanceMode: amenity.attendanceMode,
    slotsEnabled: Boolean(amenity.slotPolicy?.enabled),
    visitorsAllowed: Boolean(amenity.visitorPolicy?.allowed),
    capacity: capacitySnapshot(amenity),
    ...extra,
  };
}
