import mongoose from "mongoose";
import AmenityAnalyticsDaily from "@/models/amenities/AmenityAnalyticsDaily";
import AmenityAttendance from "@/models/amenities/AmenityAttendance";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityIncident from "@/models/amenities/AmenityIncident";
import Amenity from "@/models/amenities/Amenity";
import { ATTENDEE_TYPE, CHECKIN_METHOD, DAY_LABELS } from "./constants";
import { dayKey, hourOfDay, startOfDayUtc, endOfDayUtc, dayKeyRange, minutesBetween } from "./time";

// Analytics.
//
// Strategy: incremental rollups on write, aggregate reads over rollups.
//
// Every check-in nudges one small daily document; the dashboard then reads a few
// hundred rollup rows instead of scanning the whole attendance ledger. That is
// what keeps a year-long "peak hours" query as fast for a 5,000-flat township as
// for a 40-flat building. recomputeDay() can always restate a day from the raw
// ledger, so the rollup is a cache and never the system of record.

const toObjectId = (v) => new mongoose.Types.ObjectId(String(v));

// A rollup update must never fail a resident's check-in, so these are
// best-effort and logged rather than thrown.
async function safeBump(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[amenities] analytics ${label} failed`, err?.message);
    return null;
  }
}

export function bumpDailyOnCheckIn({ societyId, amenity, attendance, timezone }) {
  return safeBump("check-in", async () => {
    const key = attendance.dayKey || dayKey(attendance.timeIn, timezone);
    const hour = hourOfDay(attendance.timeIn, timezone);

    const inc = {
      checkIns: 1,
      guestCount: attendance.guestCount || 0,
      // Positional increment into the fixed 24-slot hour histogram.
      [`hourlyCheckIns.${hour}`]: 1,
    };
    if (attendance.attendeeType === ATTENDEE_TYPE.VISITOR) inc.visitorCheckIns = 1;
    else if (attendance.attendeeType === ATTENDEE_TYPE.STAFF) inc.staffCheckIns = 1;
    else inc.residentCheckIns = 1;

    if (attendance.checkInMethod === CHECKIN_METHOD.QR) inc.qrCheckIns = 1;
    else if (attendance.checkInMethod === CHECKIN_METHOD.OVERRIDE) inc.overrideCheckIns = 1;
    else inc.manualCheckIns = 1;

    // Two steps, not one: $setOnInsert of the whole hourlyCheckIns array and
    // $inc of a positional path into it (hourlyCheckIns.N) conflict in a
    // single update - and without the array being set first, Mongo creates
    // hourlyCheckIns as a plain object ({19: 1}) rather than a 24-slot array
    // when $inc alone hits a field that doesn't exist yet on the upsert.
    await AmenityAnalyticsDaily.findOneAndUpdate(
      { amenityId: amenity._id, dayKey: key },
      {
        $setOnInsert: {
          societyId,
          amenityName: amenity.name,
          date: startOfDayUtc(key, timezone),
          dayOfWeek: new Date(startOfDayUtc(key, timezone)).getUTCDay(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    const doc = await AmenityAnalyticsDaily.findOneAndUpdate(
      { amenityId: amenity._id, dayKey: key },
      { $inc: inc },
      { new: true },
    );

    // Track the high-water mark of concurrent occupancy for the day. Averaging
    // check-in counts would hide the moment the pool was actually rammed.
    const current = amenity.liveOccupancy || 0;
    if (current > (doc?.peakOccupancy || 0)) {
      const max = amenity.capacity?.maxOccupancy;
      await AmenityAnalyticsDaily.updateOne(
        { _id: doc._id },
        {
          $set: {
            peakOccupancy: current,
            capacityUtilisationPct: max ? Math.round((current / max) * 100) : 0,
          },
        },
      );
    }
    return doc;
  });
}

export function bumpDailyOnCheckOut({ societyId, attendance }) {
  return safeBump("check-out", async () => {
    const mins = attendance.durationMins || 0;
    const doc = await AmenityAnalyticsDaily.findOneAndUpdate(
      { amenityId: attendance.amenityId, dayKey: attendance.dayKey },
      { $inc: { totalDurationMins: mins }, $setOnInsert: { societyId, date: new Date() } },
      { new: true, upsert: true },
    );
    // Average is stored rather than derived so exports and charts agree.
    if (doc?.checkIns) {
      await AmenityAnalyticsDaily.updateOne(
        { _id: doc._id },
        { $set: { avgDurationMins: Math.round(doc.totalDurationMins / doc.checkIns) } },
      );
    }
    return doc;
  });
}

// Authoritative restatement of a single day from the raw ledger.
//
// Used by the recompute endpoint and after any manual attendance adjustment,
// because an admin editing a time-in changes durations the incremental counters
// already banked.
export async function recomputeDay({ societyId, amenityId, dayKeyStr, timezone }) {
  const from = startOfDayUtc(dayKeyStr, timezone);
  const to = endOfDayUtc(dayKeyStr, timezone);

  const rows = await AmenityAttendance.find({
    amenityId: toObjectId(amenityId),
    dayKey: dayKeyStr,
  }).select("attendeeType checkInMethod durationMins guestCount memberId timeIn timeOut").lean();

  const hourly = new Array(24).fill(0);
  const members = new Set();
  let residentCheckIns = 0, visitorCheckIns = 0, staffCheckIns = 0;
  let qrCheckIns = 0, manualCheckIns = 0, overrideCheckIns = 0;
  let totalDurationMins = 0, guestCount = 0;

  for (const r of rows) {
    hourly[hourOfDay(r.timeIn, timezone)] += 1;
    if (r.memberId) members.add(String(r.memberId));
    if (r.attendeeType === ATTENDEE_TYPE.VISITOR) visitorCheckIns += 1;
    else if (r.attendeeType === ATTENDEE_TYPE.STAFF) staffCheckIns += 1;
    else residentCheckIns += 1;
    if (r.checkInMethod === CHECKIN_METHOD.QR) qrCheckIns += 1;
    else if (r.checkInMethod === CHECKIN_METHOD.OVERRIDE) overrideCheckIns += 1;
    else manualCheckIns += 1;
    totalDurationMins += r.durationMins || 0;
    guestCount += r.guestCount || 0;
  }

  // Peak concurrency via a sweep line over check-in/check-out events. Sorting
  // OUT before IN at an identical timestamp means a hand-off does not read as
  // two people in the room.
  const events = [];
  for (const r of rows) {
    const units = 1 + (r.guestCount || 0);
    events.push({ t: new Date(r.timeIn).getTime(), delta: units });
    if (r.timeOut) events.push({ t: new Date(r.timeOut).getTime(), delta: -units });
  }
  events.sort((a, b) => (a.t - b.t) || (a.delta - b.delta));
  let running = 0, peakOccupancy = 0;
  for (const e of events) {
    running += e.delta;
    if (running > peakOccupancy) peakOccupancy = running;
  }

  // Downtime is clipped to the day so a week-long closure contributes only the
  // minutes that actually fall inside this day.
  const windows = await AmenityMaintenance.find({
    amenityId: toObjectId(amenityId),
    startDate: { $lt: to },
    endDate: { $gt: from },
  }).select("startDate endDate").lean();
  let maintenanceDowntimeMins = 0;
  for (const wn of windows) {
    const s = new Date(Math.max(new Date(wn.startDate).getTime(), from.getTime()));
    const e = new Date(Math.min(new Date(wn.endDate).getTime(), to.getTime()));
    maintenanceDowntimeMins += minutesBetween(s, e);
  }

  const [eventsHeld, eventAttendance, incidentsReported, amenity] = await Promise.all([
    AmenityEvent.countDocuments({ amenityId: toObjectId(amenityId), startAt: { $gte: from, $lte: to } }),
    AmenityAttendance.countDocuments({ amenityId: toObjectId(amenityId), dayKey: dayKeyStr, eventId: { $ne: null } }),
    AmenityIncident.countDocuments({ amenityId: toObjectId(amenityId), createdAt: { $gte: from, $lte: to } }),
    Amenity.findById(amenityId).select("name capacity").lean(),
  ]);

  const max = amenity?.capacity?.maxOccupancy;

  const doc = await AmenityAnalyticsDaily.findOneAndUpdate(
    { amenityId: toObjectId(amenityId), dayKey: dayKeyStr },
    {
      $set: {
        societyId,
        amenityName: amenity?.name || "",
        date: from,
        dayOfWeek: from.getUTCDay(),
        checkIns: rows.length,
        residentCheckIns, visitorCheckIns, staffCheckIns,
        uniqueMembers: members.size,
        guestCount,
        totalDurationMins,
        avgDurationMins: rows.length ? Math.round(totalDurationMins / rows.length) : 0,
        hourlyCheckIns: hourly,
        peakOccupancy,
        capacityUtilisationPct: max ? Math.round((peakOccupancy / max) * 100) : 0,
        qrCheckIns, manualCheckIns, overrideCheckIns,
        maintenanceDowntimeMins,
        eventsHeld, eventAttendance, incidentsReported,
        recomputedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return doc;
}

function seriesKeyFor(dayKeyStr, granularity, date) {
  if (granularity === "daily") return dayKeyStr;
  if (granularity === "monthly") return dayKeyStr.slice(0, 7);
  if (granularity === "yearly") return dayKeyStr.slice(0, 4);
  // Weekly: ISO week, so charts line up across month boundaries.
  const d = new Date(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((target - firstThursday) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// The dashboard payload: every KPI the brief asks for, in one round trip.
export async function getAnalytics({ societyId, from, to, amenityId, granularity = "daily", timezone }) {
  const keys = dayKeyRange(from, to, timezone);

  const rollups = await AmenityAnalyticsDaily.find({
    societyId: toObjectId(societyId),
    dayKey: { $in: keys },
    ...(amenityId ? { amenityId: toObjectId(amenityId) } : {}),
  }).lean();

  const totals = {
    checkIns: 0, residentCheckIns: 0, visitorCheckIns: 0, staffCheckIns: 0,
    guestCount: 0, totalDurationMins: 0, qrCheckIns: 0, manualCheckIns: 0,
    overrideCheckIns: 0, maintenanceDowntimeMins: 0, eventsHeld: 0,
    eventAttendance: 0, incidentsReported: 0, uniqueMemberDays: 0,
  };
  const hourly = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const perAmenityMap = new Map();
  const seriesMap = new Map();

  for (const r of rollups) {
    totals.checkIns += r.checkIns || 0;
    totals.residentCheckIns += r.residentCheckIns || 0;
    totals.visitorCheckIns += r.visitorCheckIns || 0;
    totals.staffCheckIns += r.staffCheckIns || 0;
    totals.guestCount += r.guestCount || 0;
    totals.totalDurationMins += r.totalDurationMins || 0;
    totals.qrCheckIns += r.qrCheckIns || 0;
    totals.manualCheckIns += r.manualCheckIns || 0;
    totals.overrideCheckIns += r.overrideCheckIns || 0;
    totals.maintenanceDowntimeMins += r.maintenanceDowntimeMins || 0;
    totals.eventsHeld += r.eventsHeld || 0;
    totals.eventAttendance += r.eventAttendance || 0;
    totals.incidentsReported += r.incidentsReported || 0;
    totals.uniqueMemberDays += r.uniqueMembers || 0;

    for (let h = 0; h < 24; h += 1) hourly[h] += r.hourlyCheckIns?.[h] || 0;
    byDow[r.dayOfWeek ?? 0] += r.checkIns || 0;

    const aid = String(r.amenityId);
    const agg = perAmenityMap.get(aid) || {
      amenityId: r.amenityId, amenityName: r.amenityName, checkIns: 0,
      visitorCheckIns: 0, totalDurationMins: 0, peakOccupancy: 0,
      maintenanceDowntimeMins: 0, utilisationPctSum: 0, days: 0,
    };
    agg.checkIns += r.checkIns || 0;
    agg.visitorCheckIns += r.visitorCheckIns || 0;
    agg.totalDurationMins += r.totalDurationMins || 0;
    agg.peakOccupancy = Math.max(agg.peakOccupancy, r.peakOccupancy || 0);
    agg.maintenanceDowntimeMins += r.maintenanceDowntimeMins || 0;
    agg.utilisationPctSum += r.capacityUtilisationPct || 0;
    agg.days += 1;
    perAmenityMap.set(aid, agg);

    const sk = seriesKeyFor(r.dayKey, granularity, r.date);
    const bucket = seriesMap.get(sk) || { period: sk, checkIns: 0, visitors: 0, durationMins: 0, peakOccupancy: 0 };
    bucket.checkIns += r.checkIns || 0;
    bucket.visitors += r.visitorCheckIns || 0;
    bucket.durationMins += r.totalDurationMins || 0;
    bucket.peakOccupancy = Math.max(bucket.peakOccupancy, r.peakOccupancy || 0);
    seriesMap.set(sk, bucket);
  }

  // Amenities with zero visits in the range never earn a rollup row, but
  // "least used" is only a meaningful signal if the zeroes are visible
  // alongside the ones that had traffic.
  const allAmenities = await Amenity.find({
    societyId: toObjectId(societyId),
    isDeleted: false,
    ...(amenityId ? { _id: toObjectId(amenityId) } : {}),
  }).select("name").lean();
  for (const am of allAmenities) {
    const aid = String(am._id);
    if (!perAmenityMap.has(aid)) {
      perAmenityMap.set(aid, {
        amenityId: am._id, amenityName: am.name, checkIns: 0,
        visitorCheckIns: 0, totalDurationMins: 0, peakOccupancy: 0,
        maintenanceDowntimeMins: 0, utilisationPctSum: 0, days: 0,
      });
    }
  }

  const perAmenity = [...perAmenityMap.values()].map((a) => ({
    ...a,
    avgDurationMins: a.checkIns ? Math.round(a.totalDurationMins / a.checkIns) : 0,
    avgUtilisationPct: a.days ? Math.round(a.utilisationPctSum / a.days) : 0,
  })).sort((a, b) => b.checkIns - a.checkIns);

  // "Least used" only considers amenities with recorded activity; listing every
  // amenity that has never been touched would bury the actionable signal.
  const used = perAmenity.filter((a) => a.checkIns > 0);

  return {
    range: { from, to, granularity, days: keys.length },
    totals: {
      ...totals,
      avgDurationMins: totals.checkIns ? Math.round(totals.totalDurationMins / totals.checkIns) : 0,
      qrUsagePct: totals.checkIns ? Math.round((totals.qrCheckIns / totals.checkIns) * 100) : 0,
      avgDailyCheckIns: keys.length ? Math.round(totals.checkIns / keys.length) : 0,
    },
    mostUsed: perAmenity.slice(0, 5),
    leastUsed: used.slice(-5).reverse(),
    perAmenity,
    peakHours: hourly
      .map((count, hour) => ({ hour, label: `${String(hour).padStart(2, "0")}:00`, checkIns: count }))
      .sort((a, b) => b.checkIns - a.checkIns)
      .slice(0, 6),
    hourly: hourly.map((count, hour) => ({ hour, checkIns: count })),
    peakDays: byDow
      .map((count, dow) => ({ dayOfWeek: dow, day: DAY_LABELS[dow], checkIns: count }))
      .sort((a, b) => b.checkIns - a.checkIns),
    series: [...seriesMap.values()].sort((a, b) => a.period.localeCompare(b.period)),
  };
}

// A cell opened in Excel/Sheets that starts with =, +, -, or @ is executed as
// a formula, not shown as text. An amenity or society named
// `=HYPERLINK("http://evil","click")` must not turn a routine export into a
// phishing link, so any such cell is prefixed with a leading apostrophe -
// spreadsheet apps render that as plain text and it is invisible in a CSV.
function neutralizeCsvCell(value) {
  if (typeof value !== "string" || !/^[=+\-@]/.test(value)) return value;
  return `'${value}`;
}

// Flat, spreadsheet-shaped rows for export.
export async function getExportRows({ societyId, from, to, amenityId, timezone }) {
  const keys = dayKeyRange(from, to, timezone);
  const rows = await AmenityAnalyticsDaily.find({
    societyId: toObjectId(societyId),
    dayKey: { $in: keys },
    ...(amenityId ? { amenityId: toObjectId(amenityId) } : {}),
  }).sort({ dayKey: 1, amenityName: 1 }).lean();

  return {
    headers: [
      "Date", "Amenity", "Total check-ins", "Residents", "Visitors", "Staff",
      "Guests", "Unique residents", "Avg duration (mins)", "Peak occupancy",
      "Capacity utilisation %", "QR check-ins", "Manual check-ins", "Overrides",
      "Maintenance downtime (mins)", "Events held", "Event attendance", "Incidents",
    ],
    rows: rows.map((r) => [
      r.dayKey, neutralizeCsvCell(r.amenityName), r.checkIns, r.residentCheckIns, r.visitorCheckIns,
      r.staffCheckIns, r.guestCount, r.uniqueMembers, r.avgDurationMins,
      r.peakOccupancy, r.capacityUtilisationPct, r.qrCheckIns, r.manualCheckIns,
      r.overrideCheckIns, r.maintenanceDowntimeMins, r.eventsHeld,
      r.eventAttendance, r.incidentsReported,
    ]),
  };
}
