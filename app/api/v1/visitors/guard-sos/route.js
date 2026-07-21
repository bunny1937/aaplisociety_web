import { withRoute, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { sosSchema } from "@/lib/v1/schemas";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/guard-sos — a guard raises a society-wide security alert
// (no specific member). Admins/security see it via the society-wide feed.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const parsed = sosSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const visitor = await Visitor.create({
    societyId,
    name: "Guard SOS",
    phone: "0000000000",
    purpose: "Other",
    purposeNote: parsed.data.note,
    status: "Pending",
    entryMethod: "SOS",
    enteredBy: claims.userId,
    escalation: { level: 0, stopped: false },
  });

  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: null,
    status: visitor.status,
    entryMethod: "SOS",
    isBlacklisted: false,
  });

  return json({ ok: true, visitorId: String(visitor._id) }, { status: 201 });
});
