import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { transitionBusinessProfile } from "@/lib/commercial/businessProfileService";

// Idempotent: repeating the call on a profile that is already Published returns
// 200 with changed=false instead of erroring, so a double tap or a retried
// request can never corrupt state.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = adminCommercialRoute("profiles.reactivate", async ({ societyId, userId, params }) =>
  transitionBusinessProfile({
    societyId,
    userId,
    id: params.id,
    command: "reactivate",
  }),
);
