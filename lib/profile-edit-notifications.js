// Pure content-building for profile-edit-request notifications, kept separate
// from lib/visitor-channels.js's sendInApp() (which persists + emits) so the
// message copy itself is unit-testable without a DB connection. Mirrors
// lib/tenant-notifications.js's buildTenantDecisionNotification pattern.
const SECTION_LABELS = {
  Contact: "contact details",
  FamilyMember: "family members",
  EmergencyContact: "emergency contact",
};

export function buildProfileEditDecisionNotification({ decision, section, flatNo, rejectionReason }) {
  const label = SECTION_LABELS[section] || "profile";
  if (decision === "approved") {
    return {
      type: "PROFILE_EDIT_REQUEST_APPROVED",
      title: "Profile change approved",
      message: `Your ${label} change for flat ${flatNo} has been approved.`,
    };
  }
  const reasonClause = rejectionReason ? ` Reason: ${rejectionReason}` : "";
  return {
    type: "PROFILE_EDIT_REQUEST_REJECTED",
    title: "Profile change rejected",
    message: `Your ${label} change for flat ${flatNo} was rejected.${reasonClause}`,
  };
}
