import AmenitySetting from "@/models/amenities/AmenitySetting";
import { FEATURE_FLAGS } from "./constants";

// Settings are read on nearly every request (timezone, feature flags), so they
// are cached per process for a short window. A 60s TTL is deliberate: flipping
// a flag should take effect without a deploy, but not cost a query per call.
const cache = new Map(); // societyId -> { at, doc }
const TTL_MS = 60 * 1000;

export function invalidateSettings(societyId) {
  cache.delete(String(societyId));
}

export async function getSettings(societyId) {
  const key = String(societyId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.doc;

  // Upsert-on-read: a society that has never opened the module still gets a
  // usable settings document, so no separate provisioning step is needed when
  // onboarding a new society.
  const doc = await AmenitySetting.findOneAndUpdate(
    { societyId },
    { $setOnInsert: { societyId, features: { ...FEATURE_FLAGS } } },
    { new: true, upsert: true },
  ).lean();

  cache.set(key, { at: Date.now(), doc });
  return doc;
}

export async function getTimezone(societyId) {
  const s = await getSettings(societyId);
  return s?.timezone || "Asia/Kolkata";
}

// Resolution order: amenity override -> society setting -> compiled default.
// This is what lets one clubhouse pilot a capability the rest of the society
// does not have.
export function isFeatureEnabled(settings, flag, amenity = null) {
  const override = amenity?.featureOverrides?.[flag];
  if (typeof override === "boolean") return override;
  const societyValue = settings?.features?.[flag];
  if (typeof societyValue === "boolean") return societyValue;
  return Boolean(FEATURE_FLAGS[flag]);
}

export class FeatureDisabledError extends Error {
  constructor(flag) {
    super(`The "${flag}" feature is not enabled for this society`);
    this.name = "FeatureDisabledError";
    this.code = "FEATURE_DISABLED";
    this.flag = flag;
  }
}

export async function assertFeature(societyId, flag, amenity = null) {
  const settings = await getSettings(societyId);
  if (!isFeatureEnabled(settings, flag, amenity)) throw new FeatureDisabledError(flag);
}
