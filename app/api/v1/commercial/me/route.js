import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
import { withCommercialLogging } from "@/lib/commercial/logging";
import {
  loadOwnedProfile,
  updateBusinessProfile,
} from "@/lib/commercial/businessProfileService";
import { listEffectiveCategories } from "@/lib/commercial/categoryService";
import { businessProfileUpdateSchema } from "@/lib/commercial/schemas";

// GET   /v1/commercial/me - the caller's own listing (may be null).
// PATCH /v1/commercial/me - owner self-service edit.
//
// GET only needs the module on, so an owner can always see the state of their
// own listing; PATCH additionally needs ownerEditingEnabled, which is how a
// society keeps editing with the office. Ownership is enforced by passing the
// token's memberId into the query, never an id from the body.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(
  withCommercialLogging("v1.me.get", async (req) => {
    const { claims, societyId, flags } = await commercialContext(req, "enabled");
    const profile = await loadOwnedProfile({ societyId, memberId: claims.memberId });
    return json({
      profile,
      canEdit: flags.ownerEditingEnabled === true,
      categories: await listEffectiveCategories(societyId),
    });
  }),
);

export const PATCH = withRoute(
  withCommercialLogging("v1.me.update", async (req) => {
    const { claims, societyId } = await commercialContext(req, "ownerEditingEnabled");
    const parsed = businessProfileUpdateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw zodError(parsed);

    const existing = await loadOwnedProfile({ societyId, memberId: claims.memberId });
    if (!existing) throw new ApiError(404, "Not found");

    const profile = await updateBusinessProfile({
      societyId,
      userId: claims.userId,
      id: existing.id,
      memberId: claims.memberId,
      input: parsed.data,
    });
    return json({ profile });
  }),
);
