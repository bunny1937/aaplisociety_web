// Flag gate for the MEMBER-facing /v1 commercial endpoints.
//
// It reuses the existing /v1 primitives exactly as every other v1 route does
// (getClaims -> requireTenant -> ApiError), so there is no second auth path
// and no new error shape for the Flutter client to learn.
import { ApiError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { loadCommercialFlags } from "./featureFlags";

/**
 * @param {Request} req
 * @param {"enabled"|"directoryEnabled"|"ownerEditingEnabled"} requiredFlag
 */
export async function commercialContext(req, requiredFlag = "directoryEnabled") {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const flags = await loadCommercialFlags(societyId);
  if (!flags[requiredFlag]) {
    // Same 403 whether the module is off or the specific sub-flag is off: the
    // client only needs "not available for you", and capabilities on
    // /auth/me already tell it not to show the entry point at all.
    throw new ApiError(403, "Not available for this society");
  }
  return { claims, societyId, flags };
}
