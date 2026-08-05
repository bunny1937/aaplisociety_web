// Society-level commercial feature flags. Stored in the EXISTING Society
// document under `features.commercial` (see models/Society.js). No new
// environment variable, no new deployment, no new service.
import Society from "@/models/Society";

export const DEFAULT_COMMERCIAL_FLAGS = Object.freeze({
  enabled: false,
  directoryEnabled: false,
  ownerEditingEnabled: false,
  commercialBillingEnabled: false,
});

// `enabled: false` overrides every child flag — one switch kills the module
// for a society without touching data.
export function normalizeCommercialFlags(features) {
  const raw = features?.commercial ?? {};
  const enabled = raw.enabled === true;
  return {
    enabled,
    directoryEnabled: enabled && raw.directoryEnabled === true,
    ownerEditingEnabled: enabled && raw.ownerEditingEnabled === true,
    commercialBillingEnabled: enabled && raw.commercialBillingEnabled === true,
  };
}

export async function loadCommercialFlags(societyId) {
  if (!societyId) return { ...DEFAULT_COMMERCIAL_FLAGS };
  const society = await Society.findById(societyId).select("features").lean();
  return normalizeCommercialFlags(society?.features);
}
