import { z } from "zod";
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import { setNonOccupancyCharged } from "@/lib/commercial/businessProfileService";

// Admin-only. Deliberately its own route, separate from the shared
// PATCH /api/commercial/profiles/:id (which also serves the owner
// self-service PATCH /v1/commercial/me via the same schema) — whether a
// rented-out unit is charged the non-occupancy line is a billing decision
// and must never be owner-editable.
const bodySchema = z.object({ nonOccupancyCharged: z.boolean() });

export const PATCH = adminCommercialRoute(
  "profiles.setNonOccupancyCharged",
  async ({ req, societyId, userId, params }) => {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new CommercialError(400, { error: parsed.error.flatten() }, "VALIDATION");
    }
    const profile = await setNonOccupancyCharged({
      societyId,
      userId,
      id: params.id,
      value: parsed.data.nonOccupancyCharged,
    });
    return { profile };
  },
  { requireFlag: "commercialBillingEnabled" },
);
