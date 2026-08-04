// The Amenities permission matrix, in one place.
//
// The codebase already has role gates (lib/authz.js for the website,
// lib/v1/auth.js for mobile). What those cannot express is the *capability*
// level the brief specifies — e.g. Security may scan QR and record attendance
// but must not edit an amenity. Encoding capabilities rather than sprinkling
// role-array checks means the matrix in the docs and the matrix in the code are
// the same artefact.
import { ROLES } from "@/lib/v1/constants";

export const CAPABILITY = {
  // Configuration
  MANAGE_CATEGORIES: "MANAGE_CATEGORIES",
  MANAGE_AMENITIES: "MANAGE_AMENITIES",
  MANAGE_RULES: "MANAGE_RULES",
  MANAGE_AVAILABILITY: "MANAGE_AVAILABILITY",
  MANAGE_SLOTS: "MANAGE_SLOTS",
  MANAGE_CAPACITY: "MANAGE_CAPACITY",
  CHANGE_STATUS: "CHANGE_STATUS",
  MANAGE_MAINTENANCE: "MANAGE_MAINTENANCE",
  CONFIGURE_ATTENDANCE: "CONFIGURE_ATTENDANCE",
  CONFIGURE_QR: "CONFIGURE_QR",
  MANAGE_SETTINGS: "MANAGE_SETTINGS",
  // Operations
  SCAN_QR: "SCAN_QR",
  RECORD_ATTENDANCE: "RECORD_ATTENDANCE",
  OVERRIDE_ATTENDANCE: "OVERRIDE_ATTENDANCE",
  ADJUST_ATTENDANCE: "ADJUST_ATTENDANCE",
  VERIFY_VISITORS: "VERIFY_VISITORS",
  MANAGE_EVENTS: "MANAGE_EVENTS",
  MANAGE_REGISTRATIONS: "MANAGE_REGISTRATIONS",
  // Resident actions
  VIEW_AMENITIES: "VIEW_AMENITIES",
  SELF_CHECK_IN: "SELF_CHECK_IN",
  REGISTER_EVENT: "REGISTER_EVENT",
  JOIN_WAITLIST: "JOIN_WAITLIST",
  VIEW_OWN_ATTENDANCE: "VIEW_OWN_ATTENDANCE",
  SPONSOR_VISITOR: "SPONSOR_VISITOR",
  // Oversight
  VIEW_ANALYTICS: "VIEW_ANALYTICS",
  EXPORT_ANALYTICS: "EXPORT_ANALYTICS",
  VIEW_ALL_ATTENDANCE: "VIEW_ALL_ATTENDANCE",
  REPORT_INCIDENT: "REPORT_INCIDENT",
  VIEW_INCIDENTS: "VIEW_INCIDENTS",
  MANAGE_INCIDENTS: "MANAGE_INCIDENTS",
  VIEW_ACTIVITY_LOG: "VIEW_ACTIVITY_LOG",
};

const C = CAPABILITY;

const ADMIN_CAPS = Object.values(CAPABILITY);

const SECRETARY_CAPS = ADMIN_CAPS;

// Accountant sees the books, not the pool rota. Read-only oversight so paid
// amenities (deferred) already have a reader when billing lands.
const ACCOUNTANT_CAPS = [C.VIEW_AMENITIES, C.VIEW_ANALYTICS, C.EXPORT_ANALYTICS, C.VIEW_INCIDENTS];

const AUDITOR_CAPS = [
  C.VIEW_AMENITIES,
  C.VIEW_ANALYTICS,
  C.EXPORT_ANALYTICS,
  C.VIEW_ALL_ATTENDANCE,
  C.VIEW_INCIDENTS,
  C.VIEW_ACTIVITY_LOG,
];

// Exactly the brief's Security list: scan, attendance, visitor verification,
// today's events, report incidents. Deliberately no configuration capability.
const SECURITY_CAPS = [
  C.VIEW_AMENITIES,
  C.SCAN_QR,
  C.RECORD_ATTENDANCE,
  C.OVERRIDE_ATTENDANCE,
  C.VERIFY_VISITORS,
  C.VIEW_ALL_ATTENDANCE,
  C.REPORT_INCIDENT,
];

const MEMBER_CAPS = [
  C.VIEW_AMENITIES,
  C.SELF_CHECK_IN,
  C.REGISTER_EVENT,
  C.JOIN_WAITLIST,
  C.VIEW_OWN_ATTENDANCE,
  C.SPONSOR_VISITOR,
  C.REPORT_INCIDENT,
];

export const CAPABILITY_MATRIX = {
  [ROLES.SUPER_ADMIN]: ADMIN_CAPS,
  [ROLES.ADMIN]: ADMIN_CAPS,
  [ROLES.SECRETARY]: SECRETARY_CAPS,
  [ROLES.ACCOUNTANT]: ACCOUNTANT_CAPS,
  [ROLES.AUDITOR]: AUDITOR_CAPS,
  [ROLES.SECURITY]: SECURITY_CAPS,
  [ROLES.MEMBER]: MEMBER_CAPS,
};

export function capabilitiesFor(role) {
  return CAPABILITY_MATRIX[role] || [];
}

export function can(role, capability) {
  return capabilitiesFor(role).includes(capability);
}

// Roles that may reach the admin surface at all — used to gate the website
// pages and the /api/amenities/* namespace.
export const AMENITY_ADMIN_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];
export const AMENITY_OPS_ROLES = [ROLES.ADMIN, ROLES.SECRETARY, ROLES.SECURITY];
export const AMENITY_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.SECRETARY,
  ROLES.SECURITY,
  ROLES.ACCOUNTANT,
  ROLES.AUDITOR,
  ROLES.MEMBER,
];

// ---------------------------------------------------------------------------
// Resident eligibility for a specific amenity.
//
// Distinct from role capability: a tenant has SELF_CHECK_IN in general but may
// be barred from the clubhouse, and a 6-year-old may be barred from the gym.
// Returns a reason so the app can explain the refusal instead of greying a
// button out for no visible cause.
// ---------------------------------------------------------------------------
export function checkEligibility({ amenity, occupancyType, role, age }) {
  const access = amenity?.access || {};
  const audience = access.audience || "EVERYONE";
  const isOwner = occupancyType !== "Tenant";

  if (audience === "OWNERS" && !isOwner) {
    return { eligible: false, reason: "This amenity is restricted to flat owners" };
  }
  if (audience === "TENANTS" && isOwner) {
    return { eligible: false, reason: "This amenity is restricted to tenants" };
  }
  if (audience === "STAFF" && role !== ROLES.SECURITY) {
    return { eligible: false, reason: "This amenity is restricted to society staff" };
  }
  if (audience === "COMMITTEE" && ![ROLES.ADMIN, ROLES.SECRETARY].includes(role)) {
    return { eligible: false, reason: "This amenity is restricted to committee members" };
  }
  if (audience === "CUSTOM") {
    const allowed = access.customRoles || [];
    // Custom roles are matched against the account role and the occupancy type,
    // case-insensitively, so "Owner"/"owner"/"Tenant" all resolve.
    const mine = [role, occupancyType].filter(Boolean).map((s) => String(s).toLowerCase());
    if (!allowed.some((r) => mine.includes(String(r).toLowerCase()))) {
      return { eligible: false, reason: "Your resident category cannot use this amenity" };
    }
  }
  if (typeof age === "number") {
    if (access.minAge != null && age < access.minAge) {
      return { eligible: false, reason: `Minimum age for this amenity is ${access.minAge}` };
    }
    if (access.maxAge != null && age > access.maxAge) {
      return { eligible: false, reason: `Maximum age for this amenity is ${access.maxAge}` };
    }
  }
  return { eligible: true, reason: null };
}
