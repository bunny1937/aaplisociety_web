// app/api/commercial/billing-heads/reorder/route.js
//
// NEW ROUTE.
//
// The order charges appear in used to be alphabetical by name, which had a
// real financial side effect: percentage-type heads were evaluated against a
// running total built in that alphabetical order, so renaming "Maintenance" to
// "Service Charges" could change what a shop was billed. The engine is now
// order-independent (fixed + per-sq-ft first, then percentages on that base),
// and this route only controls the order charges are PRINTED in.
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { commercialHeadReorderSchema } from "@/lib/commercial/schemas";
import { CommercialError } from "@/lib/commercial/errors";
import { reorderCommercialHeads } from "@/lib/commercial/commercialBillingHeadService";

export const PATCH = adminCommercialRoute(
  "commercial.billingHeads.reorder",
  async ({ societyId, userId, req }) => {
    const body = await req.json();
    const parsed = commercialHeadReorderSchema.safeParse(body);
    if (!parsed.success) {
      throw new CommercialError(
        400,
        { error: "Could not change the order of these charges.", code: "VALIDATION_ERROR" },
        "VALIDATION_ERROR",
      );
    }
    return reorderCommercialHeads({ societyId, userId, order: parsed.data.order });
  },
  { requireFlag: "commercialBillingEnabled" },
);
