// POST /v1/dev/test-notifications
//
// Fires EVERY push notification the app implements at one memberId, one at a
// time with a 2s gap, and returns a per-step report.
//
// This exists because "no notification arrived" had four indistinguishable
// causes: no Firebase credentials, no registered device token, the wrong user
// lookup (see flatUsers in lib/v1/notify.js), or the notification simply not
// being wired. The preflight block below tells you which one it is.
//
// Why a route and not scripts/foo.js: this project resolves "@/lib/*" through
// Next path aliases and reads Mongo/Firebase config from the Vercel env. A
// standalone node script resolves neither.
//
// SECURITY: dead unless DEV_TEST_PUSH_SECRET is set AND matched by the
// x-test-secret header.
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { Member, User, DeviceToken, Visitor } from "@/lib/v1/models";
import {
  notifyVisitorChange,
  notifyBillCreated,
  notifyPaymentReceived,
  notifyComplaintDecision,
  notifyNoticePosted,
  notifyRentPaymentSubmitted,
  notifyRentPaymentDecision,
  notifyRentReminder,
} from "@/lib/v1/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeId = () => "ffffffff" + Date.now().toString(16).slice(-8) + "ffffffff";

export const POST = withRoute(async (req) => {
  const secret = process.env.DEV_TEST_PUSH_SECRET;
  if (!secret) throw new ApiError(403, "DEV_TEST_PUSH_SECRET not configured - harness disabled");
  if (req.headers.get("x-test-secret") !== secret) throw new ApiError(403, "Bad or missing x-test-secret");

  const body = await req.json().catch(() => ({}));
  const memberId = body.memberId;
  if (!memberId) throw new ApiError(400, "memberId is required");
  const gapMs = Number.isFinite(body.gapMs) ? Math.max(0, Math.min(5000, body.gapMs)) : 2000;

  const member = await Member.findById(memberId).select("_id societyId flatNo wing").lean();
  if (!member) throw new ApiError(404, "No Member found with that _id");
  const societyId = member.societyId;

  // Preflight: the things that silently swallow every push.
  const linked = await User.find({
    $or: [{ memberId: member._id }, { "profiles.memberId": member._id }],
  })
    .select("_id name occupancyType profiles isActive")
    .lean();

  const users = [];
  for (const u of linked) {
    const profile = (u.profiles || []).find((p) => String(p.memberId) === String(member._id));
    users.push({
      userId: String(u._id),
      name: u.name,
      occupancy: profile?.occupancyType || u.occupancyType || "Owner(assumed)",
      linkedVia: profile ? "profiles[]" : "top-level memberId",
      isActive: u.isActive !== false,
      deviceTokens: await DeviceToken.countDocuments({ userId: u._id }),
    });
  }

  const preflight = {
    flat: [member.wing, member.flatNo].filter(Boolean).join("-") || String(member._id),
    firebaseConfigured: Boolean(
      process.env.FIREBASE_SA_JSON ||
        (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
    ),
    usersLinkedToFlat: users.length,
    totalDeviceTokens: users.reduce((n, a) => n + a.deviceTokens, 0),
    users,
  };

  if (!preflight.firebaseConfigured) {
    return json({
      ok: false,
      reason: "No Firebase credentials on the server. Set FIREBASE_SA_JSON in Vercel. Nothing sent.",
      preflight,
    });
  }
  if (preflight.totalDeviceTokens === 0) {
    return json({
      ok: false,
      reason: "No device tokens for any user on this flat. Open the app, allow notifications, confirm POST /v1/devices returns 200. Nothing sent.",
      preflight,
    });
  }

  // A real Visitor row so visitor notifications resolve name/role/photo exactly
  // like production traffic.
  const v = await Visitor.create({
    societyId,
    memberId: member._id,
    name: "Test Visitor (push harness)",
    phone: "9999999999",
    purpose: "Delivery",
    status: "Pending",
    entryMethod: "Manual",
    gateLabel: "Main Gate",
  });

  const visitorArgs = (status, entryMethod, isBlacklisted) => ({
    visitorId: v._id,
    societyId,
    memberId: member._id,
    status,
    entryMethod,
    isBlacklisted,
    guardName: "Test Guard",
  });

  const steps = [
    { key: "visitor_entered", label: "Visitor entered (owner only, no actions)", run: () => notifyVisitorChange(visitorArgs("Entered", "Manual", false)) },
    { key: "visitor_exited", label: "Visitor exited (owner only)", run: () => notifyVisitorChange(visitorArgs("Exited", "Manual", false)) },
    { key: "visitor_pending", label: "Visitor logged/Pending - EXPECTED: row only, NO push", run: () => notifyVisitorChange(visitorArgs("Pending", "GuardRequest", false)) },
    { key: "visitor_sos", label: "SOS (whole flat, critical)", run: () => notifyVisitorChange(visitorArgs("Pending", "SOS", false)) },
    { key: "security_alert", label: "Blacklisted visitor alert", run: () => notifyVisitorChange(visitorArgs("Pending", "Manual", true)) },
    { key: "bill_generated", label: "New bill generated", run: () => notifyBillCreated({ billId: fakeId(), societyId, memberId: member._id, amount: 2790, period: "Jul 2026" }) },
    { key: "payment_received", label: "Maintenance payment received", run: () => notifyPaymentReceived({ transactionId: fakeId(), societyId, memberId: member._id, amount: 2000, appliedAmount: 1895, advanceCredit: 105, remainingBalance: 95, period: "Jul 2026" }) },
    { key: "complaint_approved", label: "Complaint approved", run: () => notifyComplaintDecision({ complaintId: fakeId(), societyId, memberId: member._id, status: "APPROVED" }) },
    { key: "notice_posted", label: "Notice posted (SOCIETY-WIDE - every device)", run: () => notifyNoticePosted({ noticeId: fakeId(), societyId, title: "Test notice from the push harness", createdByName: "Push Harness" }) },
    { key: "rent_submitted", label: "Rent submitted by tenant -> OWNER", run: () => notifyRentPaymentSubmitted({ societyId, memberId: member._id, amount: 20000, month: "2026-07", rentPaymentId: fakeId() }) },
    { key: "rent_confirmed", label: "Rent confirmed -> TENANT", run: () => notifyRentPaymentDecision({ societyId, memberId: member._id, approved: true, amount: 20000, month: "2026-07" }) },
    { key: "rent_rejected", label: "Rent rejected -> TENANT", run: () => notifyRentPaymentDecision({ societyId, memberId: member._id, approved: false, amount: 20000, month: "2026-07", reason: "Amount does not match agreed rent" }) },
    { key: "rent_reminder", label: "Rent reminder -> TENANT", run: () => notifyRentReminder({ societyId, memberId: member._id, month: "2026-07", amount: 20000 }) },
  ];

  const only = Array.isArray(body.only) && body.only.length ? new Set(body.only) : null;
  const results = [];
  for (const step of steps) {
    if (only && !only.has(step.key)) {
      results.push({ key: step.key, label: step.label, skipped: true });
      continue;
    }
    const t0 = Date.now();
    try {
      await step.run();
      results.push({ key: step.key, label: step.label, sent: true, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ key: step.key, label: step.label, sent: false, error: e?.message ?? String(e) });
    }
    await sleep(gapMs);
  }

  await Visitor.deleteOne({ _id: v._id }).catch(() => {});

  return json({
    ok: true,
    note: "notify* helpers swallow their own errors, so sent:true means the helper ran, not that FCM accepted it. Check Vercel logs for '[v1/fcm] ... success=N failed=M' per step.",
    gapMs,
    preflight,
    steps: results,
  });
});
