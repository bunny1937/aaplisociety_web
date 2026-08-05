import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { getCommercialOverview } from "@/lib/commercial/businessProfileService";

// GET /api/commercial/overview -> counts for the Commercial home screen.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("overview.read", async ({ societyId, flags }) => {
  const overview = await getCommercialOverview({ societyId });
  return { ...overview, flags };
});
