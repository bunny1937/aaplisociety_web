import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot";
import AmenityAvailability from "@/models/amenities/AmenityAvailability";
import { toMinutes, fromMinutes } from "./time";

// Generates day-of-week slot templates from an amenity's opening windows.
//
// Slot maths, stated once:
//   start(n) = windowOpen + n * (duration + gap)
//   end(n)   = start(n) + duration - buffer
// The buffer is trimmed off the END of each slot (turnover/cleaning time that
// belongs to the slot), while the gap is dead time BETWEEN slots. Keeping them
// separate is what lets a pool run 30-minute sessions with a 5-minute clear-out
// and no gap, or 60-minute tennis with a 10-minute gap and no buffer.

export const MAX_SLOTS_PER_AMENITY = 500;

export function buildSlotsForWindow({ dayOfWeek, openTime, closeTime, policy }) {
  const duration = Number(policy?.slotDurationMins) || 60;
  const gap = Number(policy?.gapBetweenSlotsMins) || 0;
  const buffer = Number(policy?.bufferTimeMins) || 0;

  if (buffer >= duration) {
    throw new Error("Buffer time must be shorter than the slot duration");
  }

  const open = toMinutes(openTime);
  const close = toMinutes(closeTime);
  if (open == null || close == null || close <= open) return [];

  const slots = [];
  const stride = duration + gap;
  for (let n = 0; ; n += 1) {
    const start = open + n * stride;
    const rawEnd = start + duration;
    // A partial slot at the end of the day is dropped rather than truncated: a
    // 12-minute "session" on a 30-minute pool schedule is not a real slot.
    if (rawEnd > close) break;
    const end = rawEnd - buffer;
    slots.push({
      dayOfWeek,
      startTime: fromMinutes(start),
      endTime: fromMinutes(end),
      startMinutes: start,
      endMinutes: end,
      capacity: policy?.maxCapacityPerSlot ?? null,
      label: `${fromMinutes(start)} - ${fromMinutes(end)}`,
    });
    if (slots.length > MAX_SLOTS_PER_AMENITY) break;
  }
  return slots;
}

// Rebuilds the slot grid for an amenity from its weekly availability windows.
//
// Custom (hand-edited) slots are preserved by default: an admin who carved out a
// "Kids hour" should not lose it because someone changed the closing time by ten
// minutes.
export async function regenerateSlots({ amenity, policyOverrides, days, replaceCustom = false, dryRun = false }) {
  const policy = { ...(amenity.slotPolicy || {}), ...(policyOverrides || {}) };

  if (!policy.enabled) {
    return { generated: 0, slots: [], created: 0, removed: 0, skipped: "Slots are not enabled for this amenity" };
  }

  const windows = await AmenityAvailability.find({
    amenityId: amenity._id,
    type: "WEEKLY",
    isActive: true,
    ...(days?.length ? { dayOfWeek: { $in: days } } : {}),
  }).lean();

  // Fall back to the amenity's mirrored operating days/hours when no explicit
  // grid has been configured yet, so slots work immediately after creation.
  const effectiveWindows = windows.length
    ? windows
    : (amenity.operatingDays || []).map((d) => ({
        dayOfWeek: d,
        openTime: amenity.openingTime,
        closeTime: amenity.closingTime,
      }));

  // MAX_SLOTS_PER_AMENITY is a whole-amenity cap: buildSlotsForWindow only
  // guards a single day's window, so seven busy days would otherwise sum to
  // several times the cap before this loop ever notices.
  const generated = [];
  for (const win of effectiveWindows) {
    if (generated.length >= MAX_SLOTS_PER_AMENITY) break;
    generated.push(...buildSlotsForWindow({
      dayOfWeek: win.dayOfWeek,
      openTime: win.openTime,
      closeTime: win.closeTime,
      policy,
    }));
  }
  if (generated.length > MAX_SLOTS_PER_AMENITY) generated.length = MAX_SLOTS_PER_AMENITY;

  if (dryRun) {
    return { generated: generated.length, slots: generated, created: 0, removed: 0, dryRun: true };
  }

  const targetDays = days?.length ? days : [...new Set(effectiveWindows.map((wn) => wn.dayOfWeek))];

  const deleteFilter = {
    amenityId: amenity._id,
    ...(targetDays.length ? { dayOfWeek: { $in: targetDays } } : {}),
    ...(replaceCustom ? {} : { isCustom: false }),
  };
  const removed = await AmenityTimeSlot.deleteMany(deleteFilter);

  let created = 0;
  if (generated.length) {
    const docs = generated.map((s) => ({
      ...s,
      societyId: amenity.societyId,
      amenityId: amenity._id,
      isCustom: false,
      isActive: true,
    }));
    // ordered:false so a collision with a surviving custom slot skips that one
    // row instead of abandoning the whole regeneration.
    const res = await AmenityTimeSlot.insertMany(docs, { ordered: false }).catch((err) => {
      if (err?.writeErrors) return err.insertedDocs || [];
      throw err;
    });
    created = Array.isArray(res) ? res.length : 0;
  }

  return { generated: generated.length, slots: generated, created, removed: removed?.deletedCount || 0 };
}

// Which slot contains a given moment. Used at check-in so attendance can be
// attributed to a slot without materialising dated slot rows.
export async function findSlotAt({ amenityId, dayOfWeek, minutes }) {
  return AmenityTimeSlot.findOne({
    amenityId,
    dayOfWeek,
    isActive: true,
    startMinutes: { $lte: minutes },
    endMinutes: { $gt: minutes },
  }).lean();
}
