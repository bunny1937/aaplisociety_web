import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { rentPaymentCreateSchema } from "@/lib/v1/schemas";
import { RentPayment, Member } from "@/lib/v1/models";
import { SOCIETY_ADMIN_ROLES } from "@/lib/v1/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/rent-payments — admins see all society rent records; owners see their
// own flat's records.
export const GET = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const query = { societyId };
  if (!SOCIETY_ADMIN_ROLES.includes(claims.role)) {
    if (!claims.memberId) return json({ rentPayments: [] });
    query.memberId = claims.memberId;
  }
  const rentPayments = await RentPayment.find(query).sort({ paidAt: -1 }).limit(200).lean();
  return json({ rentPayments: rentPayments.map((r) => ({ ...r, _id: String(r._id) })) });
});

// POST /v1/rent-payments — owner records a rent payment received from a tenant.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId || claims.occupancyType === "Tenant") {
    throw new ApiError(403, "Only the owner can confirm rent payments");
  }
  const body = await req.json().catch(() => ({}));
  const parsed = rentPaymentCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const member = await Member.findOne({ _id: claims.memberId, societyId }).select("_id");
  if (!member) throw new ApiError(404, "Member not found");

  const rentPayment = await RentPayment.create({
    societyId,
    memberId: member._id,
    recordedByUserId: claims.userId,
    month: data.month,
    amount: data.amount,
    paymentMode: data.paymentMode,
    paidAt: new Date(data.paidAt),
    notes: data.notes,
  });
  return json({ rentPayment: { ...rentPayment.toObject(), _id: String(rentPayment._id) } }, { status: 201 });
});