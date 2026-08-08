// Applies an approved ProfileEditRequest{ section: "ShopProfile" } payload
// onto a live (non-lean) Shop document. Mirrors lib/profile-edit-apply.js's
// Member equivalent: separated out so the mutation is unit-testable without a
// DB connection. Mutates `shop` in place; caller saves it.
//
// Deliberately a SMALL allowlist. Billing-sensitive fields (isBillable,
// openingPrincipal/openingInterest, electricityMode, areaSqft) are
// admin-only and must go through app/api/commercial/shops/[id] (PATCH), never
// through owner self-service — same separation businessProfileService.js
// already draws between EDITABLE_FIELDS and setNonOccupancyCharged().
const EDITABLE_FIELDS = [
  "tradeName",
  "categoryId",
  "gstin",
  "ownerPhone",
  "ownerEmail",
  "tenantName",
  "tenantPhone",
];

export function applyShopProfileEditPayload(shop, editRequest) {
  const { payload = {} } = editRequest;
  for (const field of EDITABLE_FIELDS) {
    if (payload[field] !== undefined) shop[field] = payload[field];
  }
}
