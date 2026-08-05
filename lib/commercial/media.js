// Image policy for business logos/covers. Uploads keep using the EXISTING
// presigned direct-to-R2 flow (lib/v1/storage.js + /v1/uploads/sign); this
// module only owns the policy and the key-ownership check.
import { UPLOAD_TARGETS } from "@/lib/v1/uploadPolicy";

export const BUSINESS_MEDIA_TARGETS = {
  logo: "business-logo",
  cover: "business-cover",
};

export const BUSINESS_IMAGE_POLICY = {
  logo: { maxBytes: 2 * 1024 * 1024, maxDimension: 1024 },
  cover: { maxBytes: 5 * 1024 * 1024, maxDimension: 1920 },
  accept: ["image/jpeg", "image/png", "image/webp"],
};

// Keys are minted server-side by buildKey() as `<folder>/<societyId>/<uuid>.<ext>`
// so a caller can never attach an object belonging to another society, and
// can never overwrite an existing object (uuid per upload = immutable key).
export function isValidBusinessMediaKey(key, societyId, kind) {
  if (typeof key !== "string" || !key) return false;
  const target = UPLOAD_TARGETS[BUSINESS_MEDIA_TARGETS[kind]];
  if (!target) return false;
  const prefix = `${target.folder}/${String(societyId)}/`;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(rest);
}
