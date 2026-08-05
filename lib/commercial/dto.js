// Response projections. Routes never spread a raw Mongo document — that is
// how PII and internal fields leak. Adding a field here is safe; renaming or
// removing one is a breaking change and needs a new API version.
export function toCategoryDto(c) {
  if (!c) return null;
  return {
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    scope: c.scope,
    sortOrder: c.sortOrder ?? 100,
    isActive: c.isActive !== false,
  };
}

function hoursDto(h) {
  if (!h) return null;
  return {
    schemaVersion: h.schemaVersion ?? 1,
    timezone: h.timezone ?? "Asia/Kolkata",
    weeklySchedule: (h.weeklySchedule ?? []).map((d) => ({
      dayOfWeek: d.dayOfWeek,
      isClosed: d.isClosed === true,
      intervals: (d.intervals ?? []).map((i) => ({ opensAt: i.opensAt, closesAt: i.closesAt })),
    })),
    exceptions: (h.exceptions ?? []).map((e) => ({
      date: e.date,
      label: e.label ?? null,
      isClosed: e.isClosed !== false,
      intervals: (e.intervals ?? []).map((i) => ({ opensAt: i.opensAt, closesAt: i.closesAt })),
    })),
  };
}

// Directory card — the cheapest useful shape.
export function toDirectorySummaryDto(p) {
  if (!p) return null;
  return {
    id: String(p._id),
    tradeName: p.tradeName,
    categoryId: p.categoryId ? String(p.categoryId) : null,
    fulfillmentModes: p.fulfillmentModes ?? [],
    logoKey: p.logoKey ?? null,
    mediaVersion: p.mediaVersion ?? 0,
    unit: p.unit ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}

// Business detail for residents. No owner identity, no billing, no audit.
export function toDirectoryDetailDto(p) {
  if (!p) return null;
  return {
    ...toDirectorySummaryDto(p),
    legalName: p.legalName ?? null,
    description: p.description ?? null,
    phone: p.phone ?? null,
    whatsapp: p.whatsapp ?? null,
    email: p.email ?? null,
    gstin: p.gstin ?? null,
    licenseNumber: p.licenseNumber ?? null,
    coverKey: p.coverKey ?? null,
    businessHours: hoursDto(p.businessHours),
  };
}

// Owner/admin view: adds the workflow fields the owner is allowed to see.
export function toBusinessProfileDto(p) {
  if (!p) return null;
  return {
    ...toDirectoryDetailDto(p),
    memberId: p.memberId ? String(p.memberId) : null,
    visibilityStatus: p.visibilityStatus,
    nonOccupancyCharged: p.nonOccupancyCharged === true,
    schemaVersion: p.schemaVersion ?? 1,
    updatedReason: p.updatedReason ?? null,
    createdAt: p.createdAt ?? null,
    updatedAt: p.updatedAt ?? null,
  };
}
