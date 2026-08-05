import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import { updateSocietyCategory } from "@/lib/commercial/categoryService";
import { categoryUpdateSchema } from "@/lib/commercial/schemas";

// Only SOCIETY-scoped categories are editable here; GLOBAL rows are
// platform-managed and rejected by the service.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = adminCommercialRoute(
  "categories.update",
  async ({ req, societyId, userId, params }) => {
    const parsed = categoryUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new CommercialError(400, { error: parsed.error.flatten() }, "VALIDATION");
    }
    return {
      category: await updateSocietyCategory({
        societyId,
        userId,
        categoryId: params.id,
        input: parsed.data,
      }),
    };
  },
);
