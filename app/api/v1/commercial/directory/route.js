import { withRoute, json, zodError } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
import { withCommercialLogging } from "@/lib/commercial/logging";
import { listDirectory } from "@/lib/commercial/directoryService";
import { directoryQuerySchema } from "@/lib/commercial/schemas";

// GET /v1/commercial/directory - published businesses in the caller's society.
//
// The society filter comes from the verified token and is applied to the
// Mongo query itself, so no search term, category or cursor can widen the
// scope beyond the caller's own society.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(
  withCommercialLogging("v1.directory.list", async (req) => {
    const { societyId } = await commercialContext(req, "directoryEnabled");
    const url = new URL(req.url);
    const parsed = directoryQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      categoryId: url.searchParams.get("categoryId") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) throw zodError(parsed);

    const result = await listDirectory({
      societyId,
      categoryId: parsed.data.categoryId,
      search: parsed.data.q,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });
    return json(result);
  }),
);
