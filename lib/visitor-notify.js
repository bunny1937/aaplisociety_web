// lib/visitor-notify.js
// High-level visitor notification orchestration.
//
// Design goals (from product spec):
//  - Notify the OWNER always; if the flat is rented, ALSO notify the TENANT.
//  - Multi-channel: in-app + push + SMS/WhatsApp + email.
//  - Zero-dead-end: denying a guest is a bad outcome, so we keep trying
//    fallbacks rather than failing. Guard always gets a one-tap call option.
//  - If a resident's number is unreachable/invalid, flag the flat
//    (contactInvalid) and raise a HIGH ALERT so the number gets updated.
import Member from "@/models/Member";
import {
  sendInApp,
  sendEmail,
  sendSMS,
  sendWhatsApp,
  sendPush,
  isPlausiblePhone,
} from "@/lib/visitor-channels";
import { logAudit } from "@/lib/audit-logger";
/** Build the ordered list of contact targets for a flat (owner first, tenant next). */
export function buildRecipients(member) {
  const recipients = [];
  // Owner (always)
  recipients.push({
    role: "Owner",
    name: member.ownerName || "Owner",
    phone: member.whatsappNumber || member.contactNumber || "",
    altPhone: member.alternateContact || "",
    email: member.emailPrimary || member.emailSecondary || "",
  });
  // Tenant (only if rented and a current tenant exists)
  if (member.ownershipType === "Rented" && member.currentTenant) {
    recipients.push({
      role: "Tenant",
      name: member.currentTenant.name || "Tenant",
      phone: member.currentTenant.contactNumber || "",
      altPhone: "",
      email: member.currentTenant.email || "",
    });
  }
  return recipients;
}
function flatLabel(member) {
  return member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo;
}
/**
 * Fire the FIRST wave of notifications when a visitor is logged.
 * Returns { steps, anyReachable, channelsTried }.
 *
 * The continuous escalation ladder is driven separately by lib/escalation.js.
 */
export async function notifyVisitorApproval({
  society,
  member,
  visitor,
  guard,
}) {
  const steps = [];
  const label = flatLabel(member);
  const title = `Visitor at Gate — ${label}`;
  const message = `${visitor.name} · ${visitor.purpose}${
    visitor.purposeNote ? " — " + visitor.purposeNote : ""
  } · Guard: ${guard?.name || "Gate"}`;
  const actionUrl = `/member/visitors?id=${visitor._id}`;
  const metadata = {
    visitorId: visitor._id.toString(),
    visitorName: visitor.name,
    purpose: visitor.purpose,
    photo: visitor.photo || null,
    phone: visitor.phone || null,
    vehicleNumber: visitor.vehicleNumber || null,
    flatNo: member.flatNo,
    wing: member.wing || "",
    gateLabel: visitor.gateLabel,
    guardName: guard?.name || "",
    guardPhone: guard?.phone || "",
    isBlacklisted: !!visitor.isBlacklisted,
  };
  // 1) In-app to the flat (covers owner + tenant via member room) — most reliable.
  const inApp = await sendInApp({
    societyId: society._id || visitor.societyId,
    createdBy: visitor.enteredBy,
    createdByName: guard?.name || "Security",
    type: "VISITOR_APPROVAL",
    title,
    message,
    priority: visitor.isBlacklisted ? "high" : "normal",
    recipientType: "member",
    recipientIds: [member._id.toString()],
    actionUrl,
    metadata,
    // Auto-expire the in-app card shortly after the approval window
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  steps.push({
    level: 0,
    channel: "in_app",
    recipientRole: "Flat",
    ok: inApp.ok,
    error: inApp.error || "",
  });
  // 2) Push (best-effort, parallel with in-app).
  const push = await sendPush({ memberId: member._id, title, message });
  if (!push.skipped)
    steps.push({
      level: 0,
      channel: "push",
      recipientRole: "Flat",
      ok: push.ok,
      error: push.error || "",
    });
  // 3) Per-recipient SMS/WhatsApp/email fallbacks.
  const recipients = buildRecipients(member);
  let anyPhoneReachable = false;
  const smsBody = `AapliSociety: ${visitor.name} (${visitor.purpose}) is at ${visitor.gateLabel} for ${label}. Open the app to Approve/Deny. Guard: ${guard?.phone || ""}`;
  for (const r of recipients) {
    const phone = r.phone || r.altPhone;
    if (isPlausiblePhone(phone)) {
      anyPhoneReachable = true;
      const wa = await sendWhatsApp({ to: phone, message: smsBody });
      steps.push({
        level: 0,
        channel: "whatsapp",
        target: phone,
        recipientRole: r.role,
        ok: wa.ok,
        error: wa.error || "",
      });
      if (!wa.ok) {
        const sms = await sendSMS({ to: phone, message: smsBody });
        steps.push({
          level: 0,
          channel: "sms",
          target: phone,
          recipientRole: r.role,
          ok: sms.ok,
          error: sms.error || "",
        });
      }
    }
    if (r.email) {
      const em = await sendEmail({
        to: r.email,
        subject: `Visitor at your gate — ${label}`,
        html: `<h3>${visitor.name} is at ${visitor.gateLabel}</h3>
               <p><b>Purpose:</b> ${visitor.purpose}${visitor.purposeNote ? " — " + visitor.purposeNote : ""}</p>
               <p><b>Flat:</b> ${label}</p>
               ${visitor.photo ? `<p><img src="${visitor.photo}" width="120"/></p>` : ""}
               <p>Please open the AapliSociety app to <b>Approve</b> or <b>Deny</b> entry.</p>`,
        text: smsBody,
      });
      steps.push({
        level: 0,
        channel: "email",
        target: r.email,
        recipientRole: r.role,
        ok: em.ok,
        error: em.error || "",
      });
    }
  }
  // 4) If nobody on the flat has a plausible phone, flag contactability now.
  if (!anyPhoneReachable) {
    await flagContactInvalid({
      member,
      societyId: visitor.societyId,
      actorId: visitor.enteredBy,
      reason: "No reachable phone number on file for owner/tenant.",
    });
  }
  return {
    steps,
    anyReachable: anyPhoneReachable || inApp.ok,
    channelsTried: steps.map((s) => s.channel),
  };
}
/** Notify the guard (gate) of a resident decision so they can act immediately. */
export async function notifyGuardDecision({
  societyId,
  actorId,
  visitor,
  action,
  member,
}) {
  const label = member ? flatLabel(member) : "";
  const approved = action === "approve";
  return sendInApp({
    societyId,
    createdBy: actorId,
    createdByName: "Resident",
    type: "VISITOR_DECISION",
    title: approved ? "✅ Entry Approved" : "❌ Entry Denied",
    message: `${visitor.name} · ${visitor.purpose}${label ? " · " + label : ""}`,
    priority: "high",
    recipientType: "role",
    recipientIds: ["Security"],
    actionUrl: "/security/dashboard",
    metadata: { visitorId: visitor._id.toString(), action, flat: label },
  });
}
/** Flag a flat as unreachable + raise a HIGH ALERT to admins (idempotent-ish). */
export async function flagContactInvalid({
  member,
  societyId,
  actorId,
  reason,
}) {
  try {
    if (!member.contactInvalid) {
      await Member.updateOne(
        { _id: member._id },
        {
          contactInvalid: true,
          contactInvalidReason: reason,
          contactInvalidAt: new Date(),
        },
      );
      await logAudit(actorId, societyId, "MEMBER_CONTACT_FLAGGED", null, {
        memberId: member._id.toString(),
        flatNo: member.flatNo,
        wing: member.wing,
        reason,
      });
    }
    // HIGH ALERT to Admin/Secretary to get the number updated.
    await sendInApp({
      societyId,
      createdBy: actorId,
      createdByName: "System",
      type: "SECURITY_ALERT",
      title: `⚠️ Update contact for ${flatLabel(member)}`,
      message: `Visitor approval could not reach this flat. ${reason}`,
      priority: "high",
      recipientType: "role",
      recipientIds: ["Admin", "Secretary"],
      actionUrl: "/admin/view-members",
      metadata: { memberId: member._id.toString(), reason },
    });
  } catch (e) {
    console.error("flagContactInvalid error", e.message);
  }
}
/**
 * High-priority "someone has ENTERED to meet you" alert for offline entries.
 * Intentionally worded differently from approval requests: the person is
 * already inside, so the resident is asked to CONFIRM or FLAG, not approve.
 */
export async function notifyOfflineEntry({ society, member, visitor, guard }) {
  const steps = [];
  const label = flatLabel(member);
  const title = "⚠️ Someone entered to meet you — " + label;
  const purposeText =
    visitor.purpose + (visitor.purposeNote ? " — " + visitor.purposeNote : "");
  const message =
    visitor.name +
    " (" +
    purposeText +
    ") has ENTERED at " +
    visitor.gateLabel +
    ". Please confirm you recognise them.";
  const actionUrl = "/member/visitors?confirm=" + visitor._id;
  const metadata = {
    visitorId: visitor._id.toString(),
    visitorName: visitor.name,
    purpose: visitor.purpose,
    photo: visitor.photo || null,
    phone: visitor.phone || null,
    flatNo: member.flatNo,
    wing: member.wing || "",
    gateLabel: visitor.gateLabel,
    guardName: (guard && guard.name) || "",
    offlineEntry: true,
    note: (visitor.offlineMeta && visitor.offlineMeta.note) || "",
  };
  // 1) In-app (the resident's confirmation card links here).
  const inApp = await sendInApp({
    societyId: (society && society._id) || visitor.societyId,
    createdBy: visitor.enteredBy,
    createdByName: (guard && guard.name) || "Security",
    type: "VISITOR_ENTERED_OFFLINE",
    title,
    message,
    priority: "high",
    recipientType: "member",
    recipientIds: [member._id.toString()],
    actionUrl,
    metadata,
    expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  });
  steps.push({
    level: 0,
    channel: "in_app",
    recipientRole: "Flat",
    ok: !!inApp.ok,
    error: inApp.error || "",
  });
  // 2) Free Web Push (if you wired up the free-push pack).
  try {
    const push = await sendPush({
      memberId: member._id,
      title,
      message,
      url: actionUrl,
    });
    if (push && !push.skipped) {
      steps.push({
        level: 0,
        channel: "push",
        recipientRole: "Flat",
        ok: !!push.ok,
        error: push.error || "",
      });
    }
  } catch (e) {}
  // 3) WhatsApp -> SMS -> Email to every reachable contact on the flat.
  const recipients = buildRecipients(member);
  let anyPhoneReachable = false;
  const body =
    "AapliSociety ALERT: " +
    visitor.name +
    " (" +
    visitor.purpose +
    ") has ENTERED to meet you at " +
    visitor.gateLabel +
    ", flat " +
    label +
    ". If you do NOT recognise them, open the app and tap 'I don't recognise' right away.";
  for (const r of recipients) {
    const phone = r.phone || r.altPhone;
    if (isPlausiblePhone(phone)) {
      anyPhoneReachable = true;
      const wa = await sendWhatsApp({ to: phone, message: body });
      steps.push({
        level: 0,
        channel: "whatsapp",
        target: phone,
        recipientRole: r.role,
        ok: !!wa.ok,
        error: wa.error || "",
      });
      if (!wa.ok) {
        const sms = await sendSMS({ to: phone, message: body });
        steps.push({
          level: 0,
          channel: "sms",
          target: phone,
          recipientRole: r.role,
          ok: !!sms.ok,
          error: sms.error || "",
        });
      }
    }
    if (r.email) {
      const photoHtml = visitor.photo
        ? "<p><img src='" + visitor.photo + "' width='120'/></p>"
        : "";
      const em = await sendEmail({
        to: r.email,
        subject: "Someone entered to meet you — " + label,
        html:
          "<h3>" +
          visitor.name +
          " has ENTERED at " +
          visitor.gateLabel +
          "</h3><p><b>Purpose:</b> " +
          purposeText +
          "</p><p><b>Flat:</b> " +
          label +
          "</p>" +
          photoHtml +
          "<p>If you do <b>not</b> recognise this person, open the app and tap <b>I don't recognise</b> right away.</p>",
        text: body,
      });
      steps.push({
        level: 0,
        channel: "email",
        target: r.email,
        recipientRole: r.role,
        ok: !!em.ok,
        error: em.error || "",
      });
    }
  }
  return { steps, anyReachable: anyPhoneReachable || !!inApp.ok };
}
