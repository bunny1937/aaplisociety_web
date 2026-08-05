import { withRoute, json } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
import { withCommercialLogging } from "@/lib/commercial/logging";
import { listEffectiveCategories } from "@/lib/commercial/categoryService";

// GET /v1/commercial/categories - shared defaults merged with this society's
// own categories, active ones only, for the directory filter chips.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(
  withCommercialLogging("v1.categories.list", async (req) => {
    const { societyId } = await commercialContext(req, "directoryEnabled");
    return json({ categories: await listEffectiveCategories(societyId) });
  }),
);
