import { withRoute, ApiError, json } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
import { withCommercialLogging } from "@/lib/commercial/logging";
import { getDirectoryEntry } from "@/lib/commercial/directoryService";

// GET /v1/commercial/directory/:id
// An id from another society and an id that does not exist both return the
// same 404, so this cannot be used to enumerate other societies.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(
  withCommercialLogging("v1.directory.get", async (req, ctx) => {
    const { societyId } = await commercialContext(req, "directoryEnabled");
    const { id } = (await ctx?.params) ?? {};
    const business = await getDirectoryEntry({ societyId, id });
    if (!business) throw new ApiError(404, "Not found");
    return json({ business });
  }),
);
