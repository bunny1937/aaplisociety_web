import crypto from "node:crypto";
import { withRoute, json, zodError } from "@/lib/v1/http";
import { forgotPasswordSchema } from "@/lib/v1/schemas";
import { User } from "@/lib/v1/models";
import { enforceRateLimit } from "@/lib/v1/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256(v) {
  return crypto.createHash("sha256").update(v).digest("hex");
}

async function sendResetEmail(to, code) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn("[v1] BREVO_API_KEY not set \u2014 reset code (dev only):", code);
    return;
  }
  try {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || "Aapli Society" },
        to: [{ email: to }],
        subject: "Your password reset code",
        htmlContent: `<p>Your password reset code is <b>${code}</b>. It expires in 15 minutes.</p>`,
      }),
    });
  } catch (e) {
    console.error("[v1] reset email failed:", e?.message ?? e);
  }
}

export const POST = withRoute(async (req) => {
  enforceRateLimit(req, "forgot-password", { windowMs: 15 * 60 * 1000, limit: 5 });
  const body = await req.json().catch(() => ({}));
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);
  const { identifier } = parsed.data;

  const user = await User.findOne({
    $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
  });

  // Always return ok to avoid account enumeration.
  if (user && user.email) {
    const code = String(crypto.randomInt(100000, 1000000));
    user.resetCodeHash = sha256(code);
    user.resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    user.resetCodeAttempts = 0;
    await user.save();
    await sendResetEmail(user.email, code);
  }

  return json({ ok: true });
});
