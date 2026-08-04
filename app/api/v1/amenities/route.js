import { withRoute, json } from "@/lib/v1/http";
import { getClaims } from "@/lib/v1/auth";
import connectDB from "@/lib/mongodb";
import Amenity from "@/models/amenities/Amenity";
import AmenityCategory from "@/models/amenities/AmenityCategory";
import { memberContext, publicAmenity } from "@/lib/amenities/memberContext";
import { resolveEffectiveStatus } from "@/lib/amenities/availability";
import { checkEligibility } from "@/lib/amenities/permissions";
import { getTimezone } from "@/lib/amenities/settingsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/amenities
//
// The resident amenities list, grouped by category. Every row already carries
// its effective status and whether *this* resident may use it, so the app never
// has to reimplement the rules and can render an honest, greyed-out card with a
// reason instead of a broken check-in.
export const GET = withRoute(async (request) => {
  const claims = await getClaims(request);
  await connectDB();
  const ctx = await memberContext(claims, request);

  const sp = new URL(request.url).searchParams;
  const filter = { societyId: ctx.societyId, isDeleted: false, isActive: true };
  if (sp.get("categoryId")) filter.categoryId = sp.get("categoryId");

  const q = sp.get("q")?.trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { location: rx }];
  }

  const [rows, categories, timezone] = await Promise.all([
    Amenity.find(filter).sort({ displayOrder: 1, name: 1 }).lean(),
    AmenityCategory.find({ societyId: ctx.societyId, isDeleted: false, isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .lean(),
    getTimezone(ctx.societyId),
  ]);

  const categoryById = new Map(categories.map((c) => [String(c._id), c]));

  const amenities = await Promise.all(
    rows.map(async (a) => {
      const effective = await resolveEffectiveStatus({ amenity: a, timezone });
      const eligibility = checkEligibility({
        amenity: a,
        occupancyType: ctx.occupancyType,
        role: ctx.role,
        age: ctx.age,
      });
      return publicAmenity(
        { ...a, categoryName: categoryById.get(String(a.categoryId))?.name || "" },
        { effective, eligibility },
      );
    }),
  );

  // Grouped payload so the app renders sections without a second pass, but the
  // flat list is included too for search results.
  const grouped = categories
    .map((c) => ({
      categoryId: c._id,
      name: c.name,
      description: c.description || "",
      amenities: amenities.filter((a) => String(a.categoryId) === String(c._id)),
    }))
    .filter((group) => group.amenities.length > 0);

  return json({ amenities, categories: grouped });
});
