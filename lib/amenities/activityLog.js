import AmenityActivityLog from "@/models/amenities/AmenityActivityLog";

// Audit writes must never break the user's action. Every call is wrapped: if
// the log write fails we surface it in the server logs and let the mutation
// stand, rather than failing a resident's check-in because an index was
// rebuilding.
async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error("[amenities/activityLog]", err?.message || err);
    return null;
  }
}

// Bookkeeping/volatile fields that change on every write and would drown the
// audit trail if treated as "real" edits.
const VOLATILE_FIELDS = new Set(["updatedAt", "createdAt", "__v", "liveOccupancy", "updatedBy"]);

// Shallow diff over the union of both objects' keys. Returns just the changed
// field names - callers that also need before/after snapshots build them from
// this list (see logUpdate) rather than diffFields carrying that shape itself.
export function diffFields(prev, next) {
  const prevObj = prev || {};
  const nextObj = next || {};
  const keys = new Set([...Object.keys(prevObj), ...Object.keys(nextObj)]);
  const changed = [];
  for (const key of keys) {
    if (VOLATILE_FIELDS.has(key)) continue;
    const a = prevObj[key];
    const b = nextObj[key];
    const same = JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!same) changed.push(key);
  }
  return changed;
}

/**
 * Record one amenity activity entry.
 *
 * `actor` is the shape both auth layers can produce: { userId, name, role, ip,
 * userAgent } — the website passes cookie-JWT claims, the mobile layer passes
 * bearer claims, and neither has to know about this collection's schema.
 */
export async function logAmenityActivity({
  societyId,
  entityType,
  entityId = null,
  amenityId = null,
  amenityName = "",
  action,
  actor = {},
  changedFields = [],
  oldValue = null,
  newValue = null,
  note = "",
}) {
  return safe(() =>
    AmenityActivityLog.create({
      societyId,
      entityType,
      entityId,
      amenityId,
      amenityName,
      action,
      userId: actor.userId || null,
      userName: actor.name || "",
      userRole: actor.role || "",
      changedFields,
      oldValue,
      newValue,
      note,
      ip: actor.ip || null,
      userAgent: actor.userAgent || null,
      at: new Date(),
    }),
  );
}

// Convenience wrapper for the common "I updated a document" case.
export async function logUpdate({ prev, next, ...rest }) {
  const changedFields = diffFields(prev, next);
  if (!changedFields.length) return null; // no-op edits do not deserve a log line
  const oldValue = {};
  const newValue = {};
  for (const key of changedFields) {
    oldValue[key] = prev?.[key] ?? null;
    newValue[key] = next?.[key] ?? null;
  }
  return logAmenityActivity({ ...rest, changedFields, oldValue, newValue });
}
