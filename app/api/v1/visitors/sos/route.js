import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { sosSchema } from "@/lib/v1/schemas";
import { Visitor } from "@/lib/v1/models";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/sos — a resident raises an emergency SOS. Recorded as a
// visitor row with entryMethod SOS so it surfaces to guards/admins.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can raise SOS");
  const body = await req.json().catch(() => ({}));
  const parsed = sosSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const visitor = await Visitor.create({
    societyId,
    memberId: claims.memberId,
    name: "SOS Alert",
    phone: "0000000000",
    purpose: "Other",
    purposeNote: parsed.data.note,
    status: "Pending",
    entryMethod: "SOS",
    escalation: { level: 0, stopped: false },
  });

  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: claims.memberId,
    status: visitor.status,
    entryMethod: "SOS",
    isBlacklisted: false,
  });

  return json({ ok: true, visitorId: String(visitor._id) }, { status: 201 });
});
