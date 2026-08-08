import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { getSettings, updateSettings } from "@/lib/commercial/commercialSettingsService";

// GET /api/commercial/settings -> the society's commercial policy
// PUT /api/commercial/settings -> save it
//
// GST, interest, non-occupancy, electricity recovery, sinking/repair funds and
// the "trade details required before billing" switch all live here. They used
// to be hardcoded constants, which is why the Rate Card page could not show a
// complete answer to "what will this shop be charged".

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("settings.get", async ({ societyId }) => {
  const settings = await getSettings({ societyId });
  return { settings };
});

export const PUT = adminCommercialRoute(
  "settings.update",
  async ({ req, societyId, userId }) => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json(
        {
          error: "The settings did not reach the server. Please try saving again.",
          code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    }
    const settings = await updateSettings({ societyId, userId, input: body });
    return { settings };
  },
  { requireFlag: "enabled" },
);
