import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { RentPayment } from "@/lib/v1/models";
import { notifyRentPaymentDecision } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwned(req, id) {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (claims.occupancyType === "Tenant") throw new ApiError(403, "Only the owner can manage rent records");
  const payment = await RentPayment.findOne({ _id: id, societyId, memberId: claims.memberId });
  if (!payment) throw new ApiError(404, "Rent payment not found");
  return { claims, societyId, payment };
}

// PATCH — confirm, reject, or edit a rent record (owner CRUD).
export const PATCH = withRoute(async (req, { params }) => {
  const { claims, payment } = await loadOwned(req, params.id);
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "confirm" || action === "reject") {
    payment.status = action === "confirm" ? "Confirmed" : "Rejected";
    payment.confirmedByUserId = claims.userId;
    payment.confirmedAt = new Date();
    if (action === "reject") payment.rejectionReason = body.reason || "Not received";
  }
  for (const field of ["amount", "paymentMode", "month", "notes", "reference"]) {
    if (body[field] !== undefined) payment[field] = body[field];
  }
  if (body.paidAt) payment.paidAt = new Date(body.paidAt);
  await payment.save();

  if (action === "confirm" || action === "reject") {
    await notifyRentPaymentDecision({
      societyId: payment.societyId,
      memberId: payment.memberId,
      rentPayment: payment.toObject(),
      approved: action === "confirm",
    }).catch((e) => console.warn("rent decision notify failed", e?.message));
  }
  return json({ rentPayment: { ...payment.toObject(), _id: String(payment._id) } });
});

export const DELETE = withRoute(async (req, { params }) => {
  const { payment } = await loadOwned(req, params.id);
  await payment.deleteOne();
  return json({ success: true });
});
