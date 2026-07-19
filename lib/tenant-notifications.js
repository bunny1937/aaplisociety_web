// Pure content-building for tenant-onboarding notifications, kept separate
// from lib/visitor-channels.js's sendInApp() (which persists + emits) so the
// message copy itself is unit-testable without a DB connection.
export function buildTenantDecisionNotification({ decision, tenantName, flatNo, rejectionReason }) {
  if (decision === "approved") {
    return {
      type: "TENANT_REQUEST_APPROVED",
      title: "Tenant approved",
      message: `Your tenant ${tenantName} has been approved for flat ${flatNo}.`,
    };
  }
  const reasonClause = rejectionReason ? ` Reason: ${rejectionReason}` : "";
  return {
    type: "TENANT_REQUEST_REJECTED",
    title: "Tenant request rejected",
    message: `Your tenant request for ${tenantName} (flat ${flatNo}) was rejected.${reasonClause}`,
  };
}
