// GET /api/onboarding/verify?token=...
// Public (no auth) - the token itself is the credential, emailed to the
// member. Returns only display-safe fields; the email is masked (not
// shown in full) since the member is expected to re-enter their real one
// as a lightweight confirmation step on the set-credentials form.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { verifyToken } from "@/lib/jwt";
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!local || !domain) return "";
  const maskedLocal = local.length <= 2 ? `${local[0]}*` : `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  const [domainName, ...rest] = domain.split(".");
  const maskedDomain = domainName.length <= 2 ? `${domainName[0]}*` : `${domainName[0]}${"*".repeat(domainName.length - 2)}${domainName[domainName.length - 1]}`;
  return `${maskedLocal}@${maskedDomain}.${rest.join(".")}`;
}
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
  const decoded = verifyToken(token);
  if (!decoded || decoded.purpose !== "onboarding") {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });
  }
  try {
    await connectDB();
    const user = await User.findById(decoded.userId).select("name email mustChangePassword profiles").lean();
    if (!user)
      return NextResponse.json(
        { error: "This account no longer exists. Contact your society admin for a new invite." },
        { status: 404 },
      );
    if (!user.mustChangePassword) {
      return NextResponse.json({ error: "This account has already been set up — please log in." }, { status: 400 });
    }
    const societyName = user.profiles?.find((p) => p.isPrimary)?.societyName || user.profiles?.[0]?.societyName || "";
    return NextResponse.json({
      success: true,
      name: user.name,
      societyName,
      maskedEmail: maskEmail(user.email),
    });
  } catch (err) {
    console.error("Onboarding verify error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
