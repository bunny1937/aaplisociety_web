import { NextResponse } from "next/server";
import { adminCommercialRoute } from "@/lib/commercial/adminRoute";
import { CommercialError } from "@/lib/commercial/errors";
import {
  createBusinessProfile,
  listProfilesForAdmin,
  listCommercialUnits,
} from "@/lib/commercial/businessProfileService";
import { businessProfileCreateSchema } from "@/lib/commercial/schemas";

// GET  /api/commercial/profiles          -> profiles for this society
// GET  /api/commercial/profiles?units=1  -> shop/office units for the picker
// POST /api/commercial/profiles          -> create (always starts as Draft)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminCommercialRoute("profiles.list", async ({ req, societyId }) => {
  const url = new URL(req.url);
  if (url.searchParams.get("units") === "1") {
    return { units: await listCommercialUnits({ societyId }) };
  }
  return listProfilesForAdmin({
    societyId,
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("q") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
});

export const POST = adminCommercialRoute("profiles.create", async ({ req, societyId, userId }) => {
  const parsed = businessProfileCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new CommercialError(400, { error: parsed.error.flatten() }, "VALIDATION");
  }
  const profile = await createBusinessProfile({ societyId, userId, input: parsed.data });
  return NextResponse.json({ success: true, profile }, { status: 201 });
});
