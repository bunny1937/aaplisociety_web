// lib/visitor-channels.js
// Provider-agnostic channel adapters. Every adapter returns a uniform shape:
//   { ok: boolean, skipped?: boolean, error?: string, target?: string }
//
// Adapters NEVER throw — a failed channel must let the escalation ladder fall
// through to the next channel (zero-dead-end). Wire real providers by setting
// the relevant env vars; otherwise they no-op gracefully (and log in dev).
import Notification from "@/models/Notification";
import { emitNotification } from "@/lib/socket-server";
import connectDB from "@/lib/mongodb";
import PushSubscription from "@/models/PushSubscription";
import { getWebPush } from "@/lib/web-push";
const isProd = process.env.NODE_ENV === "production";
function devlog(...args) {
  if (!isProd) console.log("[visitor-channels]", ...args);
}
/** Normalize an Indian mobile number to E.164 (+91) when possible. */
export function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11)
    return `+91${digits.slice(1)}`;
  return `+${digits}`;
}
export function isPlausiblePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
/**
 * In-app: persist a Notification row and push it in real time over sockets.
 * This is the most reliable channel and is always attempted first.
 */
export async function sendInApp({
  societyId,
  createdBy,
  createdByName = "Security",
  type,
  title,
  message,
  priority = "normal",
  recipientType,
  recipientIds = [],
  actionUrl = null,
  metadata = {},
  expiresAt = null,
}) {
  try {
    const notification = await Notification.create({
      societyId,
      createdBy,
      createdByName,
      type,
      title,
      message,
      priority,
      recipientType,
      recipientIds,
      actionUrl,
      metadata,
      expiresAt,
      readBy: [],
    });
    try {
      emitNotification({
        ...notification.toObject(),
        _id: notification._id,
        id: notification._id.toString(),
      });
    } catch (e) {
      // socket layer may be down (e.g. serverless) — the row is still persisted
      devlog("socket emit failed (non-fatal):", e.message);
    }
    return { ok: true, target: recipientType, id: notification._id.toString() };
  } catch (error) {
    return { ok: false, error: error.message, target: recipientType };
  }
}
/** Email via Brevo (Sendinblue) transactional API. */
export async function sendEmail({ to, subject, html, text }) {
  if (!to) return { ok: false, skipped: true, error: "no recipient" };
  const apiKey = process.env.BREVO_API_KEY;
  const sender =
    process.env.BREVO_SENDER_EMAIL ||
    process.env.EMAIL_FROM ||
    "no-reply@aaplisociety.app";
  if (!apiKey) {
    devlog("BREVO_API_KEY missing — email skipped", { to, subject });
    return {
      ok: false,
      skipped: true,
      error: "email not configured",
      target: to,
    };
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: sender, name: "AapliSociety" },
        to: [{ email: to }],
        subject,
        htmlContent: html || `<p>${text || ""}</p>`,
        textContent: text || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `brevo ${res.status}: ${body.slice(0, 120)}`,
        target: to,
      };
    }
    return { ok: true, target: to };
  } catch (error) {
    return { ok: false, error: error.message, target: to };
  }
}
/**
 * SMS adapter. Supports MSG91 out of the box; falls back to a generic
 * webhook (SMS_WEBHOOK_URL) so any provider can be wired without code changes.
 */
export async function sendSMS({ to, message }) {
  const phone = toE164(to);
  if (!isPlausiblePhone(phone))
    return { ok: false, error: "invalid phone", target: phone };
  const msg91Key = process.env.MSG91_AUTH_KEY;
  const webhook = process.env.SMS_WEBHOOK_URL;
  if (!msg91Key && !webhook) {
    devlog("SMS not configured — skipped", { to: phone });
    return {
      ok: false,
      skipped: true,
      error: "sms not configured",
      target: phone,
    };
  }
  try {
    if (msg91Key) {
      const res = await fetch("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: { authkey: msg91Key, "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          sender: process.env.MSG91_SENDER_ID || "AAPLIS",
          mobiles: phone.replace("+", ""),
          message,
        }),
      });
      return res.ok
        ? { ok: true, target: phone }
        : { ok: false, error: `msg91 ${res.status}`, target: phone };
    }
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, message }),
    });
    return res.ok
      ? { ok: true, target: phone }
      : { ok: false, error: `sms webhook ${res.status}`, target: phone };
  } catch (error) {
    return { ok: false, error: error.message, target: phone };
  }
}
/** WhatsApp adapter (Brevo / Meta Cloud webhook). */
export async function sendWhatsApp({ to, message }) {
  const phone = toE164(to);
  if (!isPlausiblePhone(phone))
    return { ok: false, error: "invalid phone", target: phone };
  const webhook = process.env.WHATSAPP_WEBHOOK_URL;
  if (!webhook) {
    devlog("WhatsApp not configured — skipped", { to: phone });
    return {
      ok: false,
      skipped: true,
      error: "whatsapp not configured",
      target: phone,
    };
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: phone, message }),
    });
    return res.ok
      ? { ok: true, target: phone }
      : { ok: false, error: `whatsapp ${res.status}`, target: phone };
  } catch (error) {
    return { ok: false, error: error.message, target: phone };
  }
}
/** Free Web Push (VAPID). No-ops gracefully if not configured. */
export async function sendPush({ memberId, userId, title, message, url } = {}) {
  const wp = getWebPush();
  if (!wp) return { ok: false, skipped: true, error: "push not configured" };
  try {
    await connectDB();
    const query = memberId ? { memberId } : userId ? { userId } : null;
    if (!query) return { ok: false, skipped: true, error: "no recipient" };
    const subs = await PushSubscription.find(query).lean();
    if (!subs.length)
      return { ok: false, skipped: true, error: "no devices subscribed" };
    const payload = JSON.stringify({
      title: title || "AapliSocietyy",
      body: message || "",
      url: url || "/member/visitors",
    });
    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await wp.sendNotification(
            { endpoint: s.endpoint, keys: s.keys },
            payload,
          );
          delivered++;
        } catch (err) {
          // 404 / 410 => the browser dropped this subscription; clean it up.
          if (err.statusCode === 404 || err.statusCode === 410) {
            await PushSubscription.deleteOne({ endpoint: s.endpoint });
          }
        }
      }),
    );
    return delivered > 0
      ? { ok: true, channel: "push", delivered }
      : { ok: false, skipped: true, error: "all subscriptions stale" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
