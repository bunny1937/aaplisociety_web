import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import {
  listAllUnits,
  classifyUnit,
  bulkClassifyUnits,
} from "@/lib/commercial/businessProfileService";

// GET  /api/commercial/units                -> every unit + its class
// GET  /api/commercial/units?commercial=1   -> shop/office units only
// POST /api/commercial/units                -> { memberId, flatType }
//                                           -> { memberIds: [...], flatType }
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors the EXISTING Member.flatType enum in models/Member.js. Nothing new.
const FLAT_TYPES = [
  "1BHK",
  "2BHK",
  "3BHK",
  "4BHK",
  "5BHK+",
  "Studio",
  "Penthouse",
  "Shop",
  "Office",
];

export const GET = adminCommercialRoute("units.list", async ({ req, societyId }) => {
  const url = new URL(req.url);
  const units = await listAllUnits({
    societyId,
    search: url.searchParams.get("q") ?? undefined,
    onlyCommercial: url.searchParams.get("commercial") === "1",
  });
  return { units, flatTypes: FLAT_TYPES };
});

export const POST = adminCommercialRoute("units.classify", async ({ req, societyId, userId }) => {
  const body = await req.json().catch(() => null);
  const memberId = body?.memberId;
  const flatType = body?.flatType;
  // Bulk branch: { memberIds: [...], flatType }
  if (Array.isArray(body?.memberIds)) {
    if (!FLAT_TYPES.includes(flatType)) {
      throw new CommercialError(400, "Invalid unit type", "VALIDATION");
    }
    const ids = body.memberIds.filter(
      (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id),
    );
    if (ids.length === 0 || ids.length > 500) {
      throw new CommercialError(400, "Select between 1 and 500 units", "VALIDATION");
    }
    return bulkClassifyUnits({ societyId, userId, memberIds: ids, flatType });
  }

  if (typeof memberId !== "string" || !/^[a-f\d]{24}$/i.test(memberId)) {
    throw new CommercialError(400, "Invalid unit", "VALIDATION");
  }
  if (!FLAT_TYPES.includes(flatType)) {
    throw new CommercialError(400, "Invalid unit type", "VALIDATION");
  }
  return classifyUnit({ societyId, userId, memberId, flatType });
});
