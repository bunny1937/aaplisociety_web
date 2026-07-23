import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { billCreateSchema } from "@/lib/v1/schemas";
import { Bill, Member } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { billWritesEnabled } from "@/lib/v1/config";
import { normalizeBill } from "@/lib/v1/billUtils";
import { notifyBillCreated } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/bills — residents see their own bills; admins may pass ?memberId=.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const url = new URL(req.url);

  const query = { societyId };
  if (BILLING_WRITE_ROLES.includes(claims.role)) {
    const memberId = url.searchParams.get("memberId");
    if (memberId) query.memberId = memberId;
  } else {
    if (!claims.memberId) return json({ bills: [] });
    query.memberId = claims.memberId;
    // Future generated bills remain admin-only until the scheduled push job
    // changes them to Unpaid. Residents must never see "Scheduled" bills.
    query.status = { $ne: "Scheduled" };
  }
  const status = url.searchParams.get("status");
  if (status && BILLING_WRITE_ROLES.includes(claims.role)) query.status = status;

  const bills = await Bill.find(query).sort({ createdAt: -1 }).limit(200);
  const memberIds = [...new Set(bills.map((b) => String(b.memberId)))];
  const members = await Member.find({ _id: { $in: memberIds } }).lean();
  const byId = new Map(members.map((m) => [String(m._id), m]));
  return json({ bills: bills.map((b) => normalizeBill(b, byId.get(String(b.memberId)))) });
});

// POST /v1/bills — create a one-off bill. GATED by BILL_WRITES_ENABLED (off by
// default) so the mobile layer never generates bills unless explicitly opted in
// (the web app owns the canonical billing engine).
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, BILLING_WRITE_ROLES);
  if (!billWritesEnabled()) throw new ApiError(403, "Bill creation from the mobile app is disabled");

  const body = await req.json().catch(() => ({}));
  const parsed = billCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const member = await Member.findOne({ _id: data.memberId, societyId }).select("_id");
  if (!member) throw new ApiError(404, "Member not found");

  const bill = await Bill.create({
    societyId,
    memberId: member._id,
    period: data.period,
    title: data.title,
    principal: data.amount,
    amount: data.amount,
    amountPaid: 0,
    status: "Unpaid",
    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
  });

  await notifyBillCreated({ billId: bill._id, societyId, memberId: member._id, amount: data.amount });
  return json({ bill }, { status: 201 });
});