import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { cronAuthorized } from "@/lib/v1/config";
import {
  recomputeScheduledBill,
  generateBillsForMembers,
} from "@/lib/billing/generationService";
import renderBillHtml from "@/lib/bill-renderer";
import { notifyBillCreated } from "@/lib/v1/notify";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flips Scheduled bills whose scheduledPushDate has arrived into Unpaid, so
// residents only ever see a bill once it has actually been pushed.
//
// Before flipping status, each bill is recomputed from LIVE Member/Society/
// BillingHead data (not the stale snapshot frozen at generation time) — so
// admin edits made after generating a scheduled batch (carpetArea, parking
// slots, config) but before the push date are reflected in what actually
// ships. Members added after the batch was generated but before push are
// also picked up and billed for the same period, immediately (not scheduled
// again) — see backfill loop below.
async function handle(req) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await connectDB();
    const now = new Date();
    now.setHours(23, 59, 59, 999); // include full day

    const due = await Bill.find({
      status: "Scheduled",
      scheduledPushDate: { $lte: now },
      isDeleted: { $ne: true },
    })
      .select("_id societyId memberId billPeriodId billMonth billYear")
      .lean();

    let pushed = 0;
    const errors = [];
    // Group by society+period so we can backfill members who don't yet have
    // a bill for that period (e.g. added after the scheduled batch ran).
    const groups = new Map();
    for (const b of due) {
      const key = `${b.societyId}|${b.billPeriodId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          societyId: b.societyId,
          billMonth: b.billMonth,
          billYear: b.billYear,
          memberIds: new Set(),
        });
      }
      groups.get(key).memberIds.add(String(b.memberId));
    }

    for (const b of due) {
      try {
        const bill = await recomputeScheduledBill(b._id);
        if (!bill) continue;

        const [member, society] = await Promise.all([
          Member.findById(bill.memberId)
            .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary")
            .lean(),
          Society.findById(bill.societyId).lean(),
        ]);
        const breakdown =
          bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
        const renderResult = renderBillHtml(null, society, member, {
          breakdown,
          totalAmount: bill.currentCharges,
          previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
          prevRemPrincipal: bill.openingPrincipal,
          prevRemInt: bill.openingInterest,
          precomputedCurrInt: bill.currentInterest,
          precomputedMonthInterest: bill.billInterestBalance,
          balanceAmount: bill.balanceAmount,
          status: "Unpaid",
          billPeriod: bill.billPeriodId,
          billDate: new Date(bill.billYear, bill.billMonth, 1),
          dueDate: bill.dueDate,
          unpaidBills: [],
          recentTransactions: [],
        });
        bill.billHtml = renderResult.billHtml || renderResult.html;
        bill.status = "Unpaid";
        bill.scheduledPushDate = null;
        await bill.save();

        // Scheduled bills skip the "bill ready" notification at generation
        // time (they aren't due yet) — send it now that the bill is live.
        await notifyBillCreated({
          billId: bill._id,
          societyId: bill.societyId,
          memberId: bill.memberId,
          amount: bill.totalBillDue,
        });
        pushed++;
      } catch (err) {
        console.error("[PUSH-SCHEDULED] recompute failed for", b._id, err.message);
        errors.push({ billId: b._id, error: err.message });
      }
    }

    let backfilled = 0;
    for (const { societyId, billMonth, billYear, memberIds } of groups.values()) {
      const activeMembers = await Member.find({ societyId, isDeleted: { $ne: true } })
        .select("_id")
        .lean();
      const missing = activeMembers
        .map((m) => String(m._id))
        .filter((id) => !memberIds.has(id));
      if (!missing.length) continue;
      // publishMode "now" — these members are being backfilled INTO a batch
      // that's shipping live in this same run; "config" mode would re-check
      // billPushDay and could reschedule them again if config drifted since
      // the original batch was generated.
      const result = await generateBillsForMembers({
        societyId,
        memberIds: missing,
        year: billYear,
        month: billMonth + 1,
        performedBy: "Cron",
        publishMode: "now",
      });
      for (const g of result.generated) {
        const bill = await Bill.findById(g.billId).select("totalBillDue").lean();
        await notifyBillCreated({
          billId: g.billId,
          societyId,
          memberId: g.memberId,
          amount: bill?.totalBillDue || 0,
        }).catch((err) => {
          console.error("[PUSH-SCHEDULED] notify failed for backfilled bill", g.billId, err.message);
        });
        backfilled++;
      }
      if (result.failed.length) {
        for (const f of result.failed) errors.push({ memberId: f.memberId, error: f.reason });
      }
    }

    if (pushed > 0 || backfilled > 0) {
      const societyIds = new Set(due.map((b) => String(b.societyId)));
      await Promise.all(
        [...societyIds].flatMap((sid) => [
          cache.del(`billing:generated:${sid}`),
          cache.del(`payments:outstanding:${sid}`),
        ]),
      );
      await cache.del("admin:stats:global");
    }

    console.log(
      `[PUSH-SCHEDULED] Pushed ${pushed} bills, backfilled ${backfilled} new-member bills`,
    );
    return NextResponse.json({
      success: true,
      pushed,
      backfilled,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    console.error("[PUSH-SCHEDULED] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
