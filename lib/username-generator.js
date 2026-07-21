/**
 * lib/username-generator.js
 *
 * Auto-generated usernames are only a starting point — every member
 * replaces theirs during onboarding (see app/onboarding/set-credentials).
 * So the auto-generated one just needs to be short and collision-free, not
 * memorable: <societyCode>-<flatNo>, e.g. "482-101".
 */
import User from "@/models/User";
import { BloomFilter } from "@/lib/bloom-filter";
/**
 * Load every existing username into a Bloom filter once per bulk-import
 * call, so generating N usernames for a batch of members costs one query
 * instead of up to N.
 */
export async function buildUsernameBloomFilter() {
  const existing = await User.find({ username: { $exists: true, $ne: null } })
    .select("username")
    .lean();
  const bloom = new BloomFilter(existing.length);
  for (const u of existing) {
    if (u.username) bloom.add(u.username.toLowerCase());
  }
  return bloom;
}
async function isUsernameTaken(candidate, bloom) {
  // Bloom filter has no false negatives - "not present" is certain, skip the DB.
  if (!bloom.mightContain(candidate)) return false;
  // "Maybe present" - could be a false positive, confirm with an exact query.
  const exists = await User.findOne({ username: candidate }).lean();
  return !!exists;
}
/**
 * @param {string} societyCode  e.g. "482"
 * @param {string} flatNo       e.g. "101"
 * @param {BloomFilter} bloom   from buildUsernameBloomFilter(), shared across one import batch
 * @returns {Promise<string>}   lowercase username, e.g. "482-101"
 */
export async function generateSimpleUsername(societyCode, flatNo, bloom) {
  const base = `${societyCode}-${String(flatNo).trim()}`.toLowerCase().replace(/\s+/g, "");
  let candidate = base;
  let suffix = 1;
  while (await isUsernameTaken(candidate, bloom)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  bloom.add(candidate);
  return candidate;
}
