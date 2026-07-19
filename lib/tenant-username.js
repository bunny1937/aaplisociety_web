// Deterministic starting point for a tenant's username, derived from their
// phone number. The approve route (see route.js in this same directory)
// appends a numeric suffix on collision — kept out of this pure function so
// the collision-check (a DB read) doesn't need mocking to unit-test the
// base-case format.
export function generateTenantUsername(tenantPhone) {
  const digitsOnly = String(tenantPhone || "").replace(/\D/g, "");
  return `tenant.${digitsOnly}`;
}
