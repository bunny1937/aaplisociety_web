import BusinessProfile from "@/models/BusinessProfile";
import Member from "@/models/Member";
import {
  DIRECTORY_PAGE_SIZE_DEFAULT,
  DIRECTORY_PAGE_SIZE_MAX,
  SEARCH_TERM_MAX_LENGTH,
  VISIBILITY_STATUS,
} from "./constants";
import { notFound } from "./errors";
import { toDirectoryDetailDto, toDirectorySummaryDto } from "./dto";

export function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the directory filter. Society scope is applied FIRST and can never be
 * replaced or weakened by a search term, category, cursor or sort option —
 * this function is unit-tested for exactly that.
 */
export function buildDirectoryFilter({ societyId, categoryId, search, cursor }) {
  const filter = {
    societyId,
    visibilityStatus: VISIBILITY_STATUS.PUBLISHED,
    isDeleted: { $ne: true },
  };
  if (categoryId) filter.categoryId = categoryId;
  if (cursor) filter._id = { $lt: cursor };
  const term = typeof search === "string" ? search.trim().slice(0, SEARCH_TERM_MAX_LENGTH) : "";
  if (term.length >= 2) {
    filter.tradeName = { $regex: escapeRegex(term), $options: "i" };
  }
  return filter;
}

export function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DIRECTORY_PAGE_SIZE_DEFAULT;
  return Math.min(Math.trunc(n), DIRECTORY_PAGE_SIZE_MAX);
}

// Unit label (wing/flat) comes from the EXISTING Member record, never copied
// into BusinessProfile — one source of truth for what a unit is called.
async function attachUnits(societyId, rows) {
  const memberIds = rows.map((r) => r.memberId).filter(Boolean);
  if (!memberIds.length) return rows;
  const members = await Member.find({ _id: { $in: memberIds }, societyId })
    .select("wing flatNo flatType")
    .lean();
  const byId = new Map(members.map((m) => [String(m._id), m]));
  return rows.map((r) => {
    const m = byId.get(String(r.memberId));
    return {
      ...r,
      unit: m
        ? { wing: m.wing ?? null, flatNo: m.flatNo ?? null, flatType: m.flatType ?? null }
        : null,
    };
  });
}

export async function listDirectory({ societyId, categoryId, search, cursor, limit }) {
  const pageSize = clampLimit(limit);
  const filter = buildDirectoryFilter({ societyId, categoryId, search, cursor });
  const rows = await BusinessProfile.find(filter)
    .select("tradeName categoryId fulfillmentModes logoKey mediaVersion memberId updatedAt")
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const withUnits = await attachUnits(societyId, page);
  return {
    businesses: withUnits.map(toDirectorySummaryDto),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  };
}

export async function getDirectoryEntry({ societyId, id }) {
  const row = await BusinessProfile.findOne({
    _id: id,
    societyId,
    visibilityStatus: VISIBILITY_STATUS.PUBLISHED,
    isDeleted: { $ne: true },
  }).lean();
  if (!row) throw notFound();
  const [withUnit] = await attachUnits(societyId, [row]);
  return toDirectoryDetailDto(withUnit);
}
