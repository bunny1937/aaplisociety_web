// lib/blacklist.js
// Helper for checking a visitor against the society watchlist.

import Blacklist from "@/models/Blacklist";

/**
 * Returns the matching active blacklist entry (by phone, else by exact-ish name)
 * or null. Phone match is preferred and most reliable.
 */
export async function checkBlacklist({ societyId, phone, name }) {
  const norm = Blacklist.normalizePhone(phone);
  if (norm) {
    const byPhone = await Blacklist.findOne({
      societyId,
      active: true,
      phone: norm,
    }).lean();
    if (byPhone) return byPhone;
  }
  if (name && name.trim().length >= 3) {
    const byName = await Blacklist.findOne({
      societyId,
      active: true,
      name: { $regex: `^${escapeRegex(name.trim())}$`, $options: "i" },
    }).lean();
    if (byName) return byName;
  }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
