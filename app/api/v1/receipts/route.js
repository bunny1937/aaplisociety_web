import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Receipt } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { periodLabelFrom } from "@/lib/v1/periodLabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/receipts — residents see their own receipts; admins may pass
// ?memberId=.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);

  const query = { societyId };
  if (BILLING_WRITE_ROLES.includes(claims.role)) {
    const memberId = url.searchParams.get("memberId");
    if (memberId) query.memberId = memberId;
  } else {
    if (!claims.memberId) return json({ receipts: [] });
    query.memberId = claims.memberId;
  }

  const receipts = await Receipt.find(query).sort({ paidAt: -1, createdAt: -1 }).limit(200).lean();
  return json({
    receipts: receipts.map((r) => ({ ...r, _id: String(r._id), periodLabel: periodLabelFrom(r) })),
  });
});
