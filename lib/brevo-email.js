/**
 * lib/brevo-email.js
 *
 * Same pattern as apps/mobile-backend/src/lib/brevo.ts - plain fetch against
 * Brevo's transactional email API, no SDK dependency. Brevo env vars have
 * been sitting in .env.local unused until now (see the mobile-backend
 * forgot-password feature, which uses the same account).
 */

export async function sendEmail({ to, subject, html }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: process.env.BREVO_SENDER_NAME || "AapliSocietyy",
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
}

export function onboardingEmailHtml({ memberName, societyName, setCredentialsUrl }) {
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hi ${memberName},</p>
      <p>Your account for <strong>${societyName}</strong> on AapliSocietyy has been created.</p>
      <p>Before you can log in, set up your own username and password:</p>
      <p style="margin: 24px 0;">
        <a href="${setCredentialsUrl}" style="background:#1e40af;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Set up my account
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">This link expires in 7 days. If it stops working, contact your society admin for a new one.</p>
    </div>
  `;
}
