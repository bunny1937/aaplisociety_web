import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { commercialBillingHeadCreateSchema } from "@/lib/commercial/schemas";
import { CommercialError } from "@/lib/commercial/errors";
import { listCommercialHeadsForAdmin, createCommercialHead } from "@/lib/commercial/commercialBillingHeadService";

export const GET = adminCommercialRoute(
  "commercial.billingHeads.list",
  async ({ societyId }) => ({ heads: await listCommercialHeadsForAdmin(societyId) }),
  { requireFlag: "commercialBillingEnabled" },
);

export const POST = adminCommercialRoute(
  "commercial.billingHeads.create",
  async ({ societyId, userId, req }) => {
    const body = await req.json();
    const parsed = commercialBillingHeadCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new CommercialError(400, parsed.error.issues[0]?.message || "Invalid input", "VALIDATION_ERROR");
    }
    const head = await createCommercialHead({ societyId, userId, input: parsed.data });
    return { head };
  },
  { requireFlag: "commercialBillingEnabled" },
);
