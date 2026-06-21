// lib/escalation.js
// Zero-dead-end escalation ladder for pending visitor approvals.
//
// Invoked by a sweeper (cron / API route) every ~30s. For each Pending visit
// whose last notification is older than ESCALATION_STEP_MS, advance one rung:
//
//   L1  re-ping flat in-app + push
//   L2  SMS owner (+ tenant)
//   L3  WhatsApp owner (+ tenant)
//   L4  call the next contact / escalate to guard "one-tap call resident"
//   L5  exhausted → mark Expired, tell guard to use discretion + one-tap call,
//       flag contactInvalid + HIGH ALERT to admins (never silently deny).

import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import {
  sendInApp,
  sendSMS,
  sendWhatsApp,
  sendPush,
  isPlausiblePhone,
} from "@/lib/visitor-channels";
import { buildRecipients, flagContactInvalid } from "@/lib/visitor-notify";
import { logAudit } from "@/lib/audit-logger";
import { ESCALATION_STEP_MS } from "@/lib/visitor-config";

function flatLabel(member) {
  return member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo;
}

async function recordStep(visitor, step) {
  visitor.escalation.history.push(step);
  visitor.escalation.lastNotifiedAt = new Date();
  visitor.escalation.level = step.level;
}

/** Run one escalation tick for a single visitor doc. Returns the action taken. */
export async function escalateVisitor(visitor, member, guard) {
  if (!member) return { action: "skip", reason: "member missing" };
  if (visitor.status !== "Pending" || visitor.escalation.stopped)
    return { action: "skip", reason: "not pending" };

  const label = flatLabel(member);
  const recipients = buildRecipients(member);
  const phones = recipients
    .map((r) => r.phone || r.altPhone)
    .filter((p) => isPlausiblePhone(p));
  const body = `AapliSociety REMINDER: ${visitor.name} (${visitor.purpose}) still waiting at ${visitor.gateLabel} for ${label}. Approve/Deny in app.`;
  const next = (visitor.escalation.level || 0) + 1;

  // L5 — exhausted (or window elapsed): resolve gracefully, never auto-deny.
  const windowElapsed = visitor.expiresAt && new Date() > visitor.expiresAt;
  if (next >= 5 || (windowElapsed && next >= 4)) {
    visitor.status = "Expired";
    visitor.escalation.stopped = true;
    await recordStep(visitor, {
      level: 5,
      channel: "admin_alert",
      recipientRole: "Guard",
      ok: true,
    });
    await visitor.save();

    // Guard: use discretion + one-tap call (do not just turn the guest away).
    await sendInApp({
      societyId: visitor.societyId,
      createdBy: visitor.enteredBy,
      createdByName: "System",
      type: "VISITOR_ESCALATION",
      title: `⏳ No response — ${label}`,
      message: `${visitor.name} (${visitor.purpose}) got no resident response. Call the resident before deciding.`,
      priority: "high",
      recipientType: "role",
      recipientIds: ["Security"],
      actionUrl: "/security/dashboard",
      metadata: {
        visitorId: visitor._id.toString(),
        oneTapCall: recipients.map((r) => ({ role: r.role, name: r.name, phone: r.phone })),
      },
    });

    if (phones.length === 0) {
      await flagContactInvalid({
        member,
        societyId: visitor.societyId,
        actorId: visitor.enteredBy,
        reason: "No reachable number; visitor approval expired with no response.",
      });
    }
    await logAudit(visitor.enteredBy, visitor.societyId, "VISITOR_EXPIRED", null, {
      visitorId: visitor._id.toString(),
      flat: label,
    });
    return { action: "expired" };
  }

  // L1 — re-ping app + push
  if (next === 1) {
    await sendInApp({
      societyId: visitor.societyId,
      createdBy: visitor.enteredBy,
      createdByName: "Security",
      type: "VISITOR_ESCALATION",
      title: `⏰ Reminder — visitor waiting (${label})`,
      message: `${visitor.name} · ${visitor.purpose} is still at the gate.`,
      priority: "high",
      recipientType: "member",
      recipientIds: [member._id.toString()],
      actionUrl: `/member/visitors?id=${visitor._id}`,
      metadata: { visitorId: visitor._id.toString() },
    });
    await sendPush({ memberId: member._id, title: "Visitor waiting", message: body });
    await recordStep(visitor, { level: 1, channel: "in_app", recipientRole: "Flat", ok: true });
    await visitor.save();
    return { action: "reping" };
  }

  // L2 — SMS
  if (next === 2) {
    for (const r of recipients) {
      const phone = r.phone || r.altPhone;
      if (isPlausiblePhone(phone)) {
        const res = await sendSMS({ to: phone, message: body });
        await recordStep(visitor, {
          level: 2, channel: "sms", target: phone, recipientRole: r.role, ok: res.ok, error: res.error || "",
        });
      }
    }
    await visitor.save();
    return { action: "sms" };
  }

  // L3 — WhatsApp
  if (next === 3) {
    for (const r of recipients) {
      const phone = r.phone || r.altPhone;
      if (isPlausiblePhone(phone)) {
        const res = await sendWhatsApp({ to: phone, message: body });
        await recordStep(visitor, {
          level: 3, channel: "whatsapp", target: phone, recipientRole: r.role, ok: res.ok, error: res.error || "",
        });
      }
    }
    await visitor.save();
    return { action: "whatsapp" };
  }

  // L4 — hand a one-tap call to the guard
  if (next === 4) {
    await sendInApp({
      societyId: visitor.societyId,
      createdBy: visitor.enteredBy,
      createdByName: "System",
      type: "VISITOR_ESCALATION",
      title: `📞 Call resident — ${label}`,
      message: `No app response from ${label}. Tap to call the resident.`,
      priority: "high",
      recipientType: "role",
      recipientIds: ["Security"],
      actionUrl: "/security/dashboard",
      metadata: {
        visitorId: visitor._id.toString(),
        oneTapCall: recipients.map((r) => ({ role: r.role, name: r.name, phone: r.phone })),
      },
    });
    await recordStep(visitor, { level: 4, channel: "guard_call", recipientRole: "Guard", ok: true });
    await visitor.save();
    return { action: "guard_call" };
  }

  return { action: "noop" };
}

/**
 * Sweep all due Pending visitors for escalation.
 * Safe to call repeatedly; idempotent per ESCALATION_STEP_MS window.
 */
export async function runEscalationSweep({ limit = 100 } = {}) {
  const cutoff = new Date(Date.now() - ESCALATION_STEP_MS);
  const due = await Visitor.find({
    status: "Pending",
    "escalation.stopped": { $ne: true },
    $or: [
      { "escalation.lastNotifiedAt": null },
      { "escalation.lastNotifiedAt": { $lte: cutoff } },
    ],
  })
    .sort({ entryTime: 1 })
    .limit(limit);

  let processed = 0;
  const results = [];
  for (const visitor of due) {
    const member = await Member.findById(visitor.memberId)
      .select(
        "flatNo wing ownerName ownershipType currentTenant contactNumber whatsappNumber alternateContact emailPrimary emailSecondary contactInvalid",
      )
      .lean();
    const memberDoc = member ? { ...member, _id: visitor.memberId } : null;
    const r = await escalateVisitor(visitor, memberDoc, null);
    results.push({ visitorId: visitor._id.toString(), ...r });
    processed += 1;
  }
  return { processed, results };
}

/** Stop escalation when a decision is made. */
export async function stopEscalation(visitor) {
  if (!visitor.escalation) return;
  visitor.escalation.stopped = true;
}
