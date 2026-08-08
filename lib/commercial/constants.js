// ---------------------------------------------------------------------------
// Commercial module constants (additive, non-breaking)
// ---------------------------------------------------------------------------
//
// Nothing in this file changes existing behaviour. Every value is new and
// every consumer treats "absent" as "current behaviour".
//
// IMPORTANT: the physical classification of a unit is DERIVED from the
// existing Member.flatType enum (models/Member.js already ships "Shop" and
// "Office"). No second property/classification field is introduced, so there
// is exactly one source of truth for what a unit is.

export const COMMERCIAL_SCHEMA_VERSION = 1;

export const UNIT_CLASSES = {
  RESIDENTIAL: "Residential",
  SHOP: "Shop",
  OFFICE: "Office",
};
export const UNIT_CLASS_VALUES = Object.values(UNIT_CLASSES);

// Member.flatType values that may own a business profile.
export const COMMERCIAL_FLAT_TYPES = ["Shop", "Office"];

export function unitClassForMember(member) {
  const flatType = member?.flatType;
  if (flatType === "Shop") return UNIT_CLASSES.SHOP;
  if (flatType === "Office") return UNIT_CLASSES.OFFICE;
  return UNIT_CLASSES.RESIDENTIAL;
}

export function isCommercialUnit(member) {
  return COMMERCIAL_FLAT_TYPES.includes(member?.flatType);
}

export const VISIBILITY_STATUS = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  SUSPENDED: "Suspended",
};
export const VISIBILITY_STATUS_VALUES = Object.values(VISIBILITY_STATUS);

// Directory-phase fulfilment declaration only. These are descriptive labels
// shown in the directory; there is no ordering/delivery engine in this phase.
export const FULFILLMENT_MODES = ["WalkIn", "Pickup", "ShopDelivery"];

export const CATEGORY_SCOPES = { GLOBAL: "GLOBAL", SOCIETY: "SOCIETY" };
export const CATEGORY_SCOPE_VALUES = Object.values(CATEGORY_SCOPES);

// Controlled, human-readable audit reasons (updatedReason / deleteReason).
export const UPDATE_REASONS = [
  "Profile Created",
  "Business Details Updated",
  "GST Updated",
  "Category Changed",
  "Business Hours Updated",
  "Logo Updated",
  "Cover Updated",
  "Published",
  "Suspended",
  "Reactivated",
  "Deleted",
  "Restored",
  "Migration",
  "Commercial Billing Head Created",
  "Commercial Billing Head Updated",
];

// Written through the EXISTING audit infrastructure (lib/audit-logger.js →
// models/AuditLog.js). No separate commercial audit collection.
export const COMMERCIAL_AUDIT_ACTIONS = {
  PROFILE_CREATED: "BUSINESS_PROFILE_CREATED",
  PROFILE_UPDATED: "BUSINESS_PROFILE_UPDATED",
  PROFILE_PUBLISHED: "BUSINESS_PROFILE_PUBLISHED",
  PROFILE_SUSPENDED: "BUSINESS_PROFILE_SUSPENDED",
  PROFILE_REACTIVATED: "BUSINESS_PROFILE_REACTIVATED",
  UNIT_CLASSIFIED: "COMMERCIAL_UNIT_CLASSIFIED",
  CATEGORY_CREATED: "COMMERCIAL_CATEGORY_CREATED",
  CATEGORY_UPDATED: "COMMERCIAL_CATEGORY_UPDATED",
  FEATURE_ENABLED: "COMMERCIAL_FEATURE_ENABLED",
  FEATURE_DISABLED: "COMMERCIAL_FEATURE_DISABLED",
  BILLING_HEAD_CREATED: "COMMERCIAL_BILLING_HEAD_CREATED",
  BILLING_HEAD_UPDATED: "COMMERCIAL_BILLING_HEAD_UPDATED",
  BILLING_HEAD_DELETED: "COMMERCIAL_BILLING_HEAD_DELETED",
  BILLING_HEAD_REORDERED: "COMMERCIAL_BILLING_HEAD_REORDERED",
  BILLING_HEAD_SEEDED: "COMMERCIAL_BILLING_HEAD_SEEDED",
};

// Seed list for platform-managed (GLOBAL) categories. They are NOT copied
// into every society — societies read GLOBAL + their own SOCIETY rows.
export const DEFAULT_GLOBAL_CATEGORIES = [
  { name: "Grocery & Kirana", slug: "grocery-kirana", sortOrder: 10 },
  { name: "Food & Bakery", slug: "food-bakery", sortOrder: 20 },
  { name: "Medical & Pharmacy", slug: "medical-pharmacy", sortOrder: 30 },
  { name: "Salon & Wellness", slug: "salon-wellness", sortOrder: 40 },
  { name: "Laundry & Dry Clean", slug: "laundry", sortOrder: 50 },
  { name: "Stationery & Gifts", slug: "stationery-gifts", sortOrder: 60 },
  { name: "Electronics & Repairs", slug: "electronics-repairs", sortOrder: 70 },
  { name: "Home Services", slug: "home-services", sortOrder: 80 },
  { name: "Clinic & Diagnostics", slug: "clinic-diagnostics", sortOrder: 90 },
  { name: "Office & Professional", slug: "office-professional", sortOrder: 100 },
  { name: "Other", slug: "other", sortOrder: 999 },
];

// Pagination + search hard limits (tenant-isolation and 500-society scale).
export const DIRECTORY_PAGE_SIZE_DEFAULT = 20;
export const DIRECTORY_PAGE_SIZE_MAX = 50;
export const SEARCH_TERM_MAX_LENGTH = 80;
