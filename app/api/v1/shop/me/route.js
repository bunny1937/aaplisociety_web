// GET /v1/shop/me — the caller's own Shop, scoped strictly by claims.shopId
// (never a body/query id — see the IDOR rule in the shop-context design
// spec). A Residential-only caller has no shopId in its claims and gets the
// same 404 an enumeration-safety-conscious route always returns for "not
// yours", matching app/api/onboarding/lookup/route.js's wording convention.
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { commercialContext } from "@/lib/commercial/v1Gate";
import Shop from "@/models/Shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withRoute(async (req) => {
  const { claims, societyId } = await commercialContext(req, "enabled");
  if (!claims.shopId) throw new ApiError(404, "Not found");
  const shop = await Shop.findOne({ _id: claims.shopId, societyId, isDeleted: { $ne: true } }).lean();
  if (!shop) throw new ApiError(404, "Not found");
  return json({ shop: { ...shop, _id: String(shop._id) } });
});
