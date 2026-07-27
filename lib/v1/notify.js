// Inline notification fan-out for the /v1 layer.
//
// The mobile backend derived notifications from MongoDB change streams feeding
// BullMQ workers (see queues/index.ts + events/changestreams.ts). Neither
// change streams (needs a replica set + a long-lived process) nor BullMQ
// (needs Redis + a worker process) fit Vercel's serverless model, so instead
// each /v1 route calls the relevant notify* helper directly after its write.
// Each helper persists a Notification row (read back by the client's polling
// GET /v1/notifications) and sends an FCM push. All helpers are best-effort:
// a failure here never fails the originating request.
import { Notification, User, Visitor } from "./models";
import { NOTIFICATION_TYPES, VISITOR_STATUS } from "./constants";
import { sendFcmToMember, sendFcmToSociety, sendFcmToUser } from "./fcm";
import { presignDownload } from "./storage";

async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    console.error("[v1/notify] non-fatal:", e?.message ?? e);
  }
}

// ---------------------------------------------------------------------------
// Flat membership lookup.
//
// ROOT CAUSE of "no visitor notifications ever arrive": the old code queried
//   User.find({ memberId, occupancyType: { $ne: "Tenant" } })
// but a User's flat link lives in the `profiles[]` array — that is what the
// admin approve route writes (profiles[0].memberId / .occupancyType), and it is
// why sendFcmToMember already searches BOTH shapes with an $or. The top-level
// `memberId`/`occupancyType` fields only exist on older/legacy user documents,
// so for every profile-based account this find matched zero users and the loop
// body never ran. No error, no log — push silently skipped. The same bug hit
// pushToFlat, which is why rent reminders/decisions never reached tenants.
//
// Always resolve through this helper so both document shapes are handled.
// ---------------------------------------------------------------------------
async function flatUsers(memberId, { tenantsOnly = false } = {}) {
  if (!memberId) return [];
  const users = await User.find({
    $or: [{ memberId }, { "profiles.memberId": memberId }],
  })
    .select("_id occupancyType profiles")
    .lean();
  return users.filter((u) => {
    // Prefer the occupancyType on the profile for THIS flat; fall back to the
    // legacy top-level field. Absent both, treat as owner (never a tenant).
    const profile = (u.profiles || []).find((p) => String(p.memberId) === String(memberId));
    const occupancy = profile?.occupancyType || u.occupancyType || "Owner";
    return tenantsOnly ? occupancy === "Tenant" : occupancy !== "Tenant";
  });
}

// Visitor push policy. Residents were being pushed for every gate scribble —
// "Pending" (just logged), "Rejected", "Expired" — none of which the owner can
// act on from a notification. Only these get a push:
//   Entered / Exited → informational, owner only, no action buttons
//   SOS              → safety, everyone on the flat, critical
//   Blacklisted      → security alert
// Everything else still writes a Notification row so the in-app centre keeps a
// complete history; it just doesn't buzz the phone.
const PUSHABLE_STATUSES = new Set([VISITOR_STATUS.ENTERED, VISITOR_STATUS.EXITED]);

// guardId/guardName identify which guard logged the entry (GuardRequest /
// OfflineEntry / remind) so the resident's app can show who's at the gate.
export async function notifyVisitorChange({
  visitorId,
  societyId,
  memberId,
  status,
  entryMethod,
  isBlacklisted,
  guardId,
  guardName,
}) {
  await safe(async () => {
    let type = NOTIFICATION_TYPES.VISITOR_APPROVAL;
    if (entryMethod === "SOS") type = NOTIFICATION_TYPES.VISITOR_SOS;
    else if (isBlacklisted) type = NOTIFICATION_TYPES.SECURITY_ALERT;
    else if (status === VISITOR_STATUS.ENTERED && entryMethod === "Pass") type = NOTIFICATION_TYPES.VISITOR_PASS;
    else if (status === VISITOR_STATUS.ENTERED) type = NOTIFICATION_TYPES.VISITOR_ENTERED;
    else if (status === VISITOR_STATUS.EXITED) type = NOTIFICATION_TYPES.VISITOR_EXITED;
    const isSos = type === NOTIFICATION_TYPES.VISITOR_SOS;
    const isSecurity = type === NOTIFICATION_TYPES.SECURITY_ALERT;

    // Read the visitor row so the notification can say WHO and WHAT instead of
    // the useless "Visitor is now Entered".
    const visitor = await Visitor.findById(visitorId)
      .select("name phone purpose purposeNote photoKey photo gateLabel")
      .lean()
      .catch(() => null);
    const role = visitor?.purpose || "Guest";
    const visitorName = visitor?.name && visitor.name !== "SOS Alert" ? visitor.name : "";
    const gate = visitor?.gateLabel || "";

    // Title carries the ROLE (Guest / Delivery / Vendor …) because that is the
    // one word the owner actually scans for. Body carries name + gate.
    let title;
    let message;
    if (isSos) {
      title = "🚨 SOS — emergency";
      message = visitor?.purposeNote
        ? `A resident raised an emergency alert: ${visitor.purposeNote}`
        : "A resident has raised an emergency SOS alert.";
    } else if (isSecurity) {
      title = "⚠️ Blacklisted visitor at the gate";
      message = [visitorName, role, gate].filter(Boolean).join(" · ");
    } else if (status === VISITOR_STATUS.ENTERED) {
      title = `${role} entered`;
      message = [visitorName, gate].filter(Boolean).join(" · ") || "Entry logged at the gate";
    } else if (status === VISITOR_STATUS.EXITED) {
      title = `${role} left`;
      message = [visitorName, gate].filter(Boolean).join(" · ") || "Exit logged at the gate";
    } else {
      // Recorded for history only — never pushed.
      title = `${role} logged at the gate`;
      message = [visitorName, status, guardName ? `by ${guardName}` : ""].filter(Boolean).join(" · ");
    }

    const notif = await Notification.create({
      societyId,
      type,
      title,
      message,
      priority: isSos ? "critical" : isSecurity ? "high" : "normal",
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      // audience marks who should see this in the notification centre; the
      // tenant is excluded from ordinary visitor traffic (SOS excepted).
      audience: isSos ? "all" : "owner",
      metadata: {
        visitorId: String(visitorId),
        guardId: guardId ? String(guardId) : undefined,
        guardName,
        role,
        visitorName,
      },
    });

    const shouldPush = isSos || isSecurity || PUSHABLE_STATUSES.has(status);
    if (!shouldPush || !memberId) return;

    // Big-picture image: the gate photo, so the owner sees the face without
    // opening the app. Never attached to SOS (there is no photo, and the alert
    // must not be delayed by a presign round-trip failing).
    let imageUrl = null;
    if (!isSos && visitor?.photoKey) {
      imageUrl = await presignDownload(visitor.photoKey, { expiresIn: 3600 }).catch(() => null);
    }

    const data = {
      type,
      visitorId: String(visitorId),
      notificationId: String(notif._id),
      guardName: guardName || "",
      role,
      visitorName,
      // The app uses `route` to deep-link on tap instead of dumping everyone on
      // the notification centre, and `actions` to decide whether to render
      // Allow/Deny. Entry/exit are already-happened facts: nothing to action.
      route: isSos ? "/security" : "/visitors",
      actions: "none",
      sos: isSos ? "1" : "0",
    };
    const payload = {
      title: notif.title,
      body: notif.message,
      ...(imageUrl ? { imageUrl } : {}),
      ...(isSos ? { channelId: "sos_channel" } : {}),
    };

    // SOS is a safety event and goes to everyone on the flat. Ordinary visitor
    // traffic goes to the OWNER only.
    if (isSos) {
      await sendFcmToMember(String(memberId), payload, data);
      return;
    }
    const owners = await flatUsers(memberId, { tenantsOnly: false });
    if (!owners.length) {
      console.warn(`[v1/notify] no owner user found for member=${memberId} — visitor push skipped`);
    }
    for (const o of owners) {
      await sendFcmToUser(String(o._id), payload, data);
    }
  });
}

// A guard sends a note to a colleague about a specific approval (or general
// gate coordination). Persisted + pushed like every other /v1 notification.
export async function notifyGuardMessage({ societyId, fromGuardId, fromGuardName, toGuardId, message, visitorId }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.GUARD_MESSAGE,
      title: `Message from ${fromGuardName}`,
      message,
      recipientType: "user",
      recipientIds: [String(toGuardId)],
      createdBy: fromGuardId,
      createdByName: fromGuardName,
      metadata: { visitorId: visitorId ? String(visitorId) : undefined, fromGuardId: String(fromGuardId) },
    });
    await sendFcmToUser(String(toGuardId), { title: notif.title, body: notif.message }, { type: NOTIFICATION_TYPES.GUARD_MESSAGE, notificationId: String(notif._id), visitorId: visitorId ? String(visitorId) : "" });
  });
}

// A pending visitor's approval-chasing is handed off to another guard (e.g.
// shift change, or the assigned guard is busy elsewhere at the gate).
export async function notifyVisitorReassigned({ societyId, visitorId, visitorName, fromGuardName, toGuardId }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.VISITOR_REASSIGNED,
      title: "Visitor reassigned to you",
      message: `${fromGuardName} handed off ${visitorName} for you to process`,
      recipientType: "user",
      recipientIds: [String(toGuardId)],
      metadata: { visitorId: String(visitorId) },
    });
    await sendFcmToUser(String(toGuardId), { title: notif.title, body: notif.message }, { type: NOTIFICATION_TYPES.VISITOR_REASSIGNED, notificationId: String(notif._id), visitorId: String(visitorId) });
  });
}

// Mirrors handleBillChange (only fires for a newly created bill).
export async function notifyBillCreated({ billId, societyId, memberId, amount, period }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.BILL_GENERATED,
      title: "New bill generated",
      message: `${period ? `${period}: ` : ""}Rs ${amount} is due. Open the bill for full details.`,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      metadata: { billId: String(billId) },
    });
    if (memberId) {
      await sendFcmToMember(String(memberId), { title: notif.title, body: notif.message }, { type: NOTIFICATION_TYPES.BILL_GENERATED, billId: String(billId), notificationId: String(notif._id) });
    }
  });
}

// Mirrors handlePaymentChange (fired when a payment Transaction is recorded).
export async function notifyPaymentReceived({ transactionId, societyId, memberId, amount, appliedAmount = amount, advanceCredit = 0, remainingBalance = 0, period }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
      title: "Payment received",
      message: `Rs ${amount} received${period ? ` for ${period}` : ""}. Rs ${appliedAmount} applied${advanceCredit > 0 ? `; Rs ${advanceCredit} saved as advance` : ""}. Remaining Rs ${remainingBalance}.`,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      metadata: { transactionId: String(transactionId) },
    });
    if (memberId) {
      await sendFcmToMember(String(memberId), { title: notif.title, body: notif.message }, { type: NOTIFICATION_TYPES.PAYMENT_RECEIVED, transactionId: String(transactionId), notificationId: String(notif._id) });
    }
  });
}

// Mirrors handleComplaintChange (only APPROVED/REJECTED notify the member).
export async function notifyComplaintDecision({ complaintId, societyId, memberId, status }) {
  if (status !== "APPROVED" && status !== "REJECTED") return;
  await safe(async () => {
    const type = status === "APPROVED" ? NOTIFICATION_TYPES.COMPLAINT_APPROVED : NOTIFICATION_TYPES.COMPLAINT_REJECTED;
    const notif = await Notification.create({
      societyId,
      type,
      title: status === "APPROVED" ? "Complaint approved" : "Complaint rejected",
      message:
        status === "APPROVED"
          ? "Your complaint has been approved and is being addressed."
          : "Your complaint has been reviewed and rejected.",
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      metadata: { complaintId: String(complaintId) },
    });
    if (memberId) {
      await sendFcmToMember(String(memberId), { title: notif.title, body: notif.message }, { type, complaintId: String(complaintId), notificationId: String(notif._id) });
    }
  });
}

// Mirrors handleNoticeChange (society-wide fan-out).
export async function notifyNoticePosted({ noticeId, societyId, title, createdBy, createdByName }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.NOTICE_POSTED,
      title: "New notice",
      message: title,
      recipientType: "all",
      createdBy,
      createdByName,
      metadata: { noticeId: String(noticeId) },
    });
    await sendFcmToSociety(String(societyId), { title: notif.title, body: notif.message }, { type: NOTIFICATION_TYPES.NOTICE_POSTED, noticeId: String(noticeId), notificationId: String(notif._id) });
  });
}

// ---------------------------------------------------------------------------
// Rent lifecycle. A tenant submitting rent must be able to reach the owner, and
// the owner's decision must reach the tenant — otherwise the tenant is stuck
// staring at a record nobody acts on. All three reuse PAYMENT_RECEIVED so we
// stay inside the existing NOTIFICATION_TYPES enum.
//
// Each helper pushes per-user (not per-member) so a tenant's device never
// receives an owner-only notification and vice versa.
// ---------------------------------------------------------------------------

async function pushToFlat({ memberId, tenantsOnly }, payload, data) {
  // Was silently matching zero users for profile-based accounts — see the
  // flatUsers comment above.
  const users = await flatUsers(memberId, { tenantsOnly });
  if (!users.length) {
    console.warn(
      `[v1/notify] no ${tenantsOnly ? "tenant" : "owner"} user found for member=${memberId} — push skipped`,
    );
  }
  for (const u of users) {
    await sendFcmToUser(String(u._id), payload, data);
  }
}

// Tenant submitted a rent payment → notify the OWNER to confirm it.
export async function notifyRentPaymentSubmitted({ societyId, memberId, amount, month, rentPaymentId }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
      title: "Rent payment awaiting your confirmation",
      message: `Your tenant submitted ₹${amount} for ${month}. Review and confirm it.`,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      audience: "owner",
      metadata: { rentPaymentId: String(rentPaymentId), action: "confirm-rent" },
    });
    await pushToFlat(
      { memberId, tenantsOnly: false },
      { title: notif.title, body: notif.message },
      {
        type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
        notificationId: String(notif._id),
        rentPaymentId: String(rentPaymentId),
        action: "confirm-rent",
      },
    );
  });
}

// Owner confirmed or rejected → notify the TENANT.
export async function notifyRentPaymentDecision({ societyId, memberId, approved, amount, month, reason }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
      title: approved ? "Rent payment confirmed" : "Rent payment rejected",
      message: approved
        ? `Your owner confirmed ₹${amount} for ${month}.`
        : `Your owner rejected ₹${amount} for ${month}.${reason ? ` Reason: ${reason}` : ""}`,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      audience: "tenant",
      metadata: { month, approved: String(approved) },
    });
    await pushToFlat(
      { memberId, tenantsOnly: true },
      { title: notif.title, body: notif.message },
      { type: NOTIFICATION_TYPES.PAYMENT_RECEIVED, notificationId: String(notif._id) },
    );
  });
}

// Owner nudges the TENANT about rent that is due.
export async function notifyRentReminder({ societyId, memberId, month, amount }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
      title: "Rent reminder",
      message: amount
        ? `Your owner sent a reminder for ₹${amount} rent for ${month}.`
        : `Your owner sent a rent reminder for ${month}.`,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      audience: "tenant",
      metadata: { month },
    });
    await pushToFlat(
      { memberId, tenantsOnly: true },
      { title: notif.title, body: notif.message },
      { type: NOTIFICATION_TYPES.PAYMENT_RECEIVED, notificationId: String(notif._id) },
    );
  });
}

// ---------------------------------------------------------------------------
// Tenancy note thread (tenant <-> owner).
//
// The note IS the notification: whichever side posts, the other side is pushed.
// Nothing here fans out to guards or admins -- a tenancy message is private to
// the two parties on the lease.
// ---------------------------------------------------------------------------
export async function notifyTenancyNote({ societyId, memberId, requestId, text, fromTenant }) {
  await safe(async () => {
    const preview = text.length > 140 ? `${text.slice(0, 137)}...` : text;
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.TENANT_NOTE,
      title: fromTenant ? "Message from your tenant" : "Message from your owner",
      message: preview,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      // Addressed to the OTHER side of the tenancy.
      audience: fromTenant ? "owner" : "tenant",
      metadata: { tenantRequestId: String(requestId) },
    });
    await pushToFlat(
      // A note from the tenant goes to the owners of the flat; a note from the
      // owner goes to the tenants living in it.
      { memberId, tenantsOnly: !fromTenant },
      { title: notif.title, body: preview },
      {
        type: NOTIFICATION_TYPES.TENANT_NOTE,
        tenantRequestId: String(requestId),
        notificationId: String(notif._id),
      },
    );
  });
}

// ---------------------------------------------------------------------------
// SOS acknowledged.
//
// Deliberately pushed to EVERY user on the flat (owners and tenants both),
// because the alarm is ringing on every household device and each one needs the
// stop signal. The client keys off data.type === VISITOR_SOS_ACK and kills its
// local alarm; the visible notification is secondary.
//
// Not fanned out to the whole society: sendFcmToSociety would buzz every guard
// and admin phone for a resolved alert. Guard boards pick the cleared state up
// on their next poll instead.
// ---------------------------------------------------------------------------
export async function notifySosAcknowledged({ societyId, memberId, visitorId, byRole, byName, note }) {
  await safe(async () => {
    const who = byName || byRole || "The gate";
    const body = note
      ? `${who} is responding: ${note}`
      : `${who} has acknowledged the SOS and is responding.`;
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.VISITOR_SOS_ACK,
      title: "SOS acknowledged",
      message: body,
      priority: "high",
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      audience: "all",
      metadata: { visitorId: String(visitorId), byRole, byName: byName || undefined },
    });
    const data = {
      type: NOTIFICATION_TYPES.VISITOR_SOS_ACK,
      visitorId: String(visitorId),
      notificationId: String(notif._id),
      by: who,
    };
    const payload = { title: notif.title, body };
    // Owners then tenants: two calls because pushToFlat filters by occupancy.
    await pushToFlat({ memberId, tenantsOnly: false }, payload, data);
    await pushToFlat({ memberId, tenantsOnly: true }, payload, data);
  });
}
