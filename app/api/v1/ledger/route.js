import { withRoute, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { Transaction, Bill } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { periodLabelFrom } from "@/lib/v1/periodLabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/ledger — residents see their own transactions; admins may pass
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
    if (!claims.memberId) return json({ transactions: [] });
    query.memberId = claims.memberId;
  }

  const txns = await Transaction.find(query).sort({ date: -1, createdAt: -1 }).limit(200).lean();
  let visible = txns;
  if (!BILLING_WRITE_ROLES.includes(claims.role) && claims.memberId) {
    const scheduled = await Bill.find({
      societyId,
      memberId: claims.memberId,
      status: "Scheduled",
      isDeleted: { $ne: true },
    }).select("_id billPeriodId").lean();
    const hiddenBillIds = new Set(scheduled.map((b) => String(b._id)));
    const hiddenPeriods = new Set(scheduled.map((b) => b.billPeriodId).filter(Boolean));
    visible = txns.filter((t) => {
      const ref = t.referenceId ? String(t.referenceId) : null;
      return !(ref && hiddenBillIds.has(ref)) && !hiddenPeriods.has(t.billPeriodId);
    });
  }
  return json({
    transactions: visible.map((t) => ({ ...t, _id: String(t._id), periodLabel: periodLabelFrom(t) })),
  });
});