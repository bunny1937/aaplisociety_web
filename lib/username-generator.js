/**
 * lib/username-generator.js
 *
 * Generates unique usernames in the format:
 *   <SOCIETY_INITIALS>_<NAMEINITIALS>_<FLATNO>_<2_RANDOM_DIGITS>
 *
 * Examples:
 *   GH_TANVIB_1001_27
 *   SGR_MEGHAI_504_91
 *
 * Always stored lowercase; displayed uppercase in UI.
 */

import User from "@/models/User";

/**
 * Build the deterministic base (no random suffix yet).
 * @param {string} societyName  e.g. "Godbole Heights"
 * @param {string} ownerName    e.g. "Tanvi Bansal"
 * @param {string} flatNo       e.g. "1001"
 * @returns {string}            lowercase base, e.g. "gh_tanvib_1001"
 */
export function buildUsernameBase(societyName, ownerName, flatNo) {
  // Society initials — first letter of each word
  const societyInitials = societyName
    .trim()
    .split(/\s+/)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");

  // Name initials — all of first name + first letter of last name
  // "Tanvi Bansal" → TANVIB
  // "Megha Iyer"   → MEGHAI
  const nameParts = ownerName.trim().split(/\s+/).filter(Boolean);
  let nameInitials;
  if (nameParts.length >= 2) {
    nameInitials =
      nameParts[0].toUpperCase() +
      nameParts[nameParts.length - 1][0].toUpperCase();
  } else {
    nameInitials = nameParts[0]?.toUpperCase() ?? "X";
  }

  return `${societyInitials}_${nameInitials}_${flatNo}`.toLowerCase();
}

/**
 * Generate a unique username, retrying if the random suffix collides.
 * @param {string} societyName
 * @param {string} ownerName
 * @param {string} flatNo
 * @returns {Promise<string>} lowercase username
 */
export async function generateUniqueUsername(societyName, ownerName, flatNo) {
  const base = buildUsernameBase(societyName, ownerName, flatNo);
  const MAX_ATTEMPTS = 20;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    // 2-digit random suffix: 10–99
    const suffix = String(Math.floor(Math.random() * 90) + 10);
    const candidate = `${base}_${suffix}`;

    const exists = await User.findOne({ username: candidate }).lean();
    if (!exists) return candidate;
  }

  // Fallback: append timestamp millis (guaranteed unique)
  return `${base}_${Date.now() % 10000}`;
}
