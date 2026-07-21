import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { passVerifySchema } from "@/lib/v1/schemas";
import { VisitorPass, Visitor } from "@/lib/v1/models";
import { VISITOR_ACCESS_ROLES } from "@/lib/v1/constants";
import { sha256, isPassUsableNow } from "@/lib/v1/visitorUtils";
import { notifyVisitorChange } from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/pass/verify — guard verifies an OTP/QR at the gate. On
// success, records a visitor entry against the pass and increments usage.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, VISITOR_ACCESS_ROLES);
  const body = await req.json().catch(() => ({}));
  const parsed = passVerifySchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const hash = sha256(parsed.data.code);
  const pass = await VisitorPass.findOne({ societyId, $or: [{ otpHash: hash }, { qrTokenHash: hash }] });
  if (!pass) throw new ApiError(404, "Invalid pass code");
  if (!isPassUsableNow(pass)) throw new ApiError(409, "Pass is not usable right now");

  pass.usedAt = [...(pass.usedAt || []), new Date()];
  if (pass.maxUses && pass.maxUses > 0 && pass.usedAt.length >= pass.maxUses) pass.status = "Used";
  await pass.save();

  const visitor = await Visitor.create({
    societyId,
    memberId: pass.memberId,
    name: pass.visitorName,
    phone: pass.visitorPhone || "0000000000",
    purpose: pass.purpose,
    vehicleNumber: pass.vehicleNumber,
    status: "Entered",
    entryMethod: "Pass",
    passId: pass._id,
    entryTime: new Date(),
    enteredBy: claims.userId,
  });

  await notifyVisitorChange({
    visitorId: visitor._id,
    societyId,
    memberId: pass.memberId,
    status: "Entered",
    entryMethod: "Pass",
    isBlacklisted: false,
  });

  return json({ ok: true, visitor });
});
