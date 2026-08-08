// app/api/commercial/billing-heads/seed/route.js
//
// NEW ROUTE.
//
// One click creates the standard heads a Maharashtra co-operative society
// actually raises on a shop or office, instead of the admin inventing ten rows
// from a blank table. Idempotent: running it twice never duplicates a head.
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { commercialHeadSeedSchema } from "@/lib/commercial/schemas";
import { CommercialError } from "@/lib/commercial/errors";
import { seedCommercialHeads } from "@/lib/commercial/commercialBillingHeadService";
import { HEAD_PRESETS } from "@/lib/commercial/headPresets";

// GET -> what the starter pack would create, so the rate card can show a
// preview list before the admin commits to anything.
export const GET = adminCommercialRoute(
  "commercial.billingHeads.seedPreview",
  async () => ({ presets: HEAD_PRESETS }),
  { requireFlag: "commercialBillingEnabled" },
);

export const POST = adminCommercialRoute(
  "commercial.billingHeads.seed",
  async ({ societyId, userId, req }) => {
    const body = await req.json();
    const parsed = commercialHeadSeedSchema.safeParse(body);
    if (!parsed.success) {
      throw new CommercialError(
        400,
        {
          error: parsed.error.issues[0]?.message || "Choose Shop or Office first",
          code: "VALIDATION_ERROR",
        },
        "VALIDATION_ERROR",
      );
    }
    return seedCommercialHeads({
      societyId,
      userId,
      scope: parsed.data.scope,
      keys: parsed.data.keys,
    });
  },
  { requireFlag: "commercialBillingEnabled" },
);
