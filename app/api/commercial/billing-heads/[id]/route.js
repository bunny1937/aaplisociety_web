import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { commercialBillingHeadUpdateSchema } from "@/lib/commercial/schemas";
import { CommercialError } from "@/lib/commercial/errors";
import { updateCommercialHead } from "@/lib/commercial/commercialBillingHeadService";

export const PATCH = adminCommercialRoute(
  "commercial.billingHeads.update",
  async ({ societyId, userId, req, params }) => {
    const body = await req.json();
    const parsed = commercialBillingHeadUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new CommercialError(400, parsed.error.issues[0]?.message || "Invalid input", "VALIDATION_ERROR");
    }
    const head = await updateCommercialHead({ societyId, userId, headId: params.id, input: parsed.data });
    return { head };
  },
  { requireFlag: "commercialBillingEnabled" },
);
