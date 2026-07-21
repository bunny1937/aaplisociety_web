import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import { Visitor } from "@/lib/v1/models";
import { VISITOR_ESCALATION_LADDER } from "@/lib/v1/business";
import { NOTIFICATION_TYPES } from "@/lib/v1/constants";
import { sendFcmToMember } from "@/lib/v1/fcm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /v1/cron/escalate-visitors — runs every minute (see vercel.json).
//
// Polling replacement for the BullMQ delayed-job escalation ladder. For each
// still-pending visitor, computes the target ladder level from elapsed time
// since creation; if it exceeds the current level, bumps it, records history
// and pushes an FCM nudge. Terminal statuses (Approved/Entered/Rejected/...)
// naturally drop out of the query, and escalation.stopped short-circuits.
export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });

  const pending = await Visitor.find({
    status: "Pending",
    entryMethod: { $ne: "SOS" },
    "escalation.stopped": { $ne: true },
  }).limit(500);

  const now = Date.now();
  let bumped = 0;
  for (const v of pending) {
    const elapsed = (now - new Date(v.createdAt).getTime()) / 1000;
    let target = null;
    for (const rung of VISITOR_ESCALATION_LADDER) {
      if (rung.afterSeconds <= elapsed) target = rung;
    }
    if (!target) continue;
    const current = v.escalation?.level ?? 0;
    if (target.level <= current) continue;

    await Visitor.updateOne(
      { _id: v._id },
      {
        $set: { "escalation.level": target.level, "escalation.lastNotifiedAt": new Date() },
        $push: {
          "escalation.history": { level: target.level, channel: target.channels[0] ?? "push", at: new Date(), ok: true },
        },
      },
    );
    if (v.memberId) {
      await sendFcmToMember(
        String(v.memberId),
        { title: "Visitor waiting", body: `A visitor is still waiting for your approval (level ${target.level}).` },
        { type: NOTIFICATION_TYPES.VISITOR_ESCALATION, visitorId: String(v._id), level: target.level },
      );
    }
    bumped += 1;
  }

  return json({ ok: true, scanned: pending.length, bumped });
});
