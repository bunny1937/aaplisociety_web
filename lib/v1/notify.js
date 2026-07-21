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
import { Notification } from "./models";
import { NOTIFICATION_TYPES, VISITOR_STATUS } from "./constants";
import { sendFcmToMember, sendFcmToSociety, sendFcmToUser } from "./fcm";

async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    console.error("[v1/notify] non-fatal:", e?.message ?? e);
  }
}

// Mirrors queues/index.ts handleVisitorChange (minus the socket emits).
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
    const guardSuffix = guardName ? ` — logged by ${guardName}` : "";
    const notif = await Notification.create({
      societyId,
      type,
      title: isSos ? "SOS raised" : "Visitor update",
      message: isSos
        ? "A resident has raised an emergency SOS alert."
        : `Visitor is now ${status}${guardSuffix}`,
      recipientType: "member",
      recipientIds: memberId ? [String(memberId)] : [],
      metadata: { visitorId: String(visitorId), guardId: guardId ? String(guardId) : undefined, guardName },
    });
    if (memberId) {
      await sendFcmToMember(String(memberId), { title: notif.title, body: notif.message }, { type, visitorId: String(visitorId), notificationId: String(notif._id), guardName: guardName || "" });
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
export async function notifyBillCreated({ billId, societyId, memberId, amount }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.BILL_GENERATED,
      title: "New bill generated",
      message: `A new bill of Rs ${amount} is due`,
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
export async function notifyPaymentReceived({ transactionId, societyId, memberId, amount }) {
  await safe(async () => {
    const notif = await Notification.create({
      societyId,
      type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
      title: "Payment received",
      message: `A payment of Rs ${amount} was recorded on your account`,
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
