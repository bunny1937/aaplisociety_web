import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { commercialBillingHeadUpdateSchema } from "@/lib/commercial/schemas";
import { CommercialError } from "@/lib/commercial/errors";
import {
  updateCommercialHead,
  deleteCommercialHead,
} from "@/lib/commercial/commercialBillingHeadService";

const handleUpdate = async ({ societyId, userId, req, params }) => {
  const body = await req.json();
  const parsed = commercialBillingHeadUpdateSchema.safeParse(body);
  if (!parsed.success) {
    // Every failing field, not just the first, each already phrased for a
    // non-technical admin in schemas.js.
    throw new CommercialError(
      400,
      {
        error: parsed.error.issues[0]?.message || "This charge could not be saved.",
        code: "VALIDATION_ERROR",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      "VALIDATION_ERROR",
    );
  }
  const head = await updateCommercialHead({ societyId, userId, headId: params.id, input: parsed.data });
  return { head };
};

export const PATCH = adminCommercialRoute(
  "commercial.billingHeads.update",
  handleUpdate,
  { requireFlag: "commercialBillingEnabled" },
);

export const PUT = adminCommercialRoute(
  "commercial.billingHeads.update",
  handleUpdate,
  { requireFlag: "commercialBillingEnabled" },
);

// NEW: the rate card had no way to delete a charge added by mistake. Soft
// delete only — bills already generated keep their own charge snapshot.
export const DELETE = adminCommercialRoute(
  "commercial.billingHeads.delete",
  async ({ societyId, userId, req, params }) => {
    const body = await req.json().catch(() => ({}));
    return deleteCommercialHead({
      societyId,
      userId,
      headId: params.id,
      reason: typeof body?.reason === "string" ? body.reason.slice(0, 200) : null,
    });
  },
  { requireFlag: "commercialBillingEnabled" },
);
