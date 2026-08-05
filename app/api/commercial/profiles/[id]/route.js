import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import {
  loadProfileForAdmin,
  updateBusinessProfile,
} from "@/lib/commercial/businessProfileService";
import { businessProfileUpdateSchema } from "@/lib/commercial/schemas";

// A profile from another society is indistinguishable from one that does not
// exist: both return the same 404, so this endpoint cannot be used to probe
// which ids are real.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("profiles.get", async ({ societyId, params }) => ({
  profile: await loadProfileForAdmin({ societyId, id: params.id }),
}));

export const PATCH = adminCommercialRoute(
  "profiles.update",
  async ({ req, societyId, userId, params }) => {
    const parsed = businessProfileUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new CommercialError(400, { error: parsed.error.flatten() }, "VALIDATION");
    }
    return {
      profile: await updateBusinessProfile({
        societyId,
        userId,
        id: params.id,
        input: parsed.data,
      }),
    };
  },
);
