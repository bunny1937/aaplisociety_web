import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { passCreateSchema } from "@/lib/v1/schemas";
import { VisitorPass } from "@/lib/v1/models";
import { sha256, generateOtp, generateQrToken } from "@/lib/v1/visitorUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/visitors/pass — resident creates a pre-approved visitor pass. The
// plaintext OTP + QR token are returned once so the app can share them; only
// hashes are used for guard-side verification.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  if (!claims.memberId) throw new ApiError(403, "Only residents can create passes");
  const body = await req.json().catch(() => ({}));
  const parsed = passCreateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const data = parsed.data;

  const otp = generateOtp();
  const qrToken = generateQrToken();

  const pass = await VisitorPass.create({
    societyId,
    memberId: claims.memberId,
    createdBy: claims.userId,
    visitorName: data.visitorName,
    visitorPhone: data.visitorPhone,
    vehicleNumber: data.vehicleNumber,
    purpose: data.purpose,
    note: data.note,
    passType: data.passType,
    recurrence: data.recurrence,
    validFrom: new Date(data.validFrom),
    expiresAt: new Date(data.expiresAt),
    maxUses: data.maxUses ?? (data.passType === "OneTime" ? 1 : 0),
    otp,
    otpHash: sha256(otp),
    qrTokenHash: sha256(qrToken),
    status: "Active",
  });

  return json(
    {
      pass: {
        _id: String(pass._id),
        visitorName: pass.visitorName,
        passType: pass.passType,
        validFrom: pass.validFrom,
        expiresAt: pass.expiresAt,
        maxUses: pass.maxUses,
        status: pass.status,
      },
      otp,
      qrToken,
    },
    { status: 201 },
  );
});
