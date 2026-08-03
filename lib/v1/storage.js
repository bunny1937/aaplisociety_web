// R2 / S3 object storage for the /v1 layer. Ported from mobile-backend
// src/services/storage.ts. Uses the same env vars as the web app's
// lib/tenant-storage.js (R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY).
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

const BUCKET = process.env.R2_BUCKET;

// Fail fast and loudly at boot instead of letting every upload return a
// confusing runtime error. Missing R2 env vars were indistinguishable from
// "the photo was never taken" in the client.
for (const [name, value] of Object.entries({
  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
})) {
  if (!value) console.error(`[v1/storage] missing env var ${name} — object storage will fail`);
}

// Keys are class-first, then tenant-scoped: <folder>/<societyId>/<uuid>.<ext>
//
// ## Why the order was flipped (this one matters)
//
// It used to be `societyId/<folder>/<uuid>.<ext>`. That reads more naturally,
// but it makes automatic cleanup impossible: R2 (and S3) lifecycle rules match
// on a *key prefix*, anchored at the start of the key. With the society id
// first, there is no single prefix that means "all visitor photos" - you would
// need one lifecycle rule per society, added by hand every time you onboard a
// new one. That is why visitor photos were accumulating forever.
//
// With the class first, one rule covers the whole bucket for all time:
//
//   prefix: "visitor-photos/"   ->  expire after 90 days
//   prefix: "tenant-docs/"      ->  never expire (legal records)
//   prefix: "retention/"        ->  expire after 180 days (archive bundles)
//
// Visitor photos are operational data - useful for a week, evidence for a month,
// dead weight after that. Tenant documents are legal records and must be kept.
// Separating them by prefix is what lets you apply different retention to each.
//
// Backwards compatibility: existing objects keep their old keys, and reads use
// the key stored on the document (`visitor.photoKey`), so nothing breaks. Only
// newly uploaded objects land under the new layout.
export function buildKey(societyId, folder, ext) {
  return `${folder}/${societyId}/${randomUUID()}.${String(ext).replace(/^\./, "")}`;
}

// ---------------------------------------------------------------------------
// Direct-to-R2 uploads
// ---------------------------------------------------------------------------
//
// ## Why uploads no longer go through the function (the 4.5MB bug)
//
// Vercel rejects any request body over 4.5MB *before* the route handler runs.
// The old flow read the whole file with `req.formData()` and buffered it in
// the function, so:
//
//   - tenant documents advertised a 10MB limit but died above 4.5MB
//   - visitor photos advertised 5MB but died above 4.5MB
//   - the platform's rejection is a raw 413 with no JSON body, so the app
//     showed a generic "upload failed" and the user retried the same file
//
// It also billed you twice for every byte: once inbound to the function, once
// outbound to R2 (that is the 67.6% inbound share of Fast Origin Transfer).
//
// The presigned flow sends ~300 bytes through Vercel and the file goes
// straight from the device to R2. No size ceiling other than R2's own.

/**
 * Presign a PUT. `contentType` is baked into the signature, so a client that
 * uploads a different type gets a 403 from R2 — it cannot lie about the type
 * to smuggle an executable past `detectFileType`.
 *
 * `maxBytes` is enforced server-side afterwards via headObject() in
 * finalizeUpload(); R2 does not support content-length-range on plain
 * presigned PUTs (only on POST policies), so the check happens at attach time.
 */
export async function presignUpload(key, contentType, { expiresIn = 300 } = {}) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

// Read URLs are handed to the Flutter client and rendered inside visitor cards
// and image caches. A 600s lifetime expired while a resident still had the
// visitor list on screen, so the photo turned into a broken image with no way
// to recover short of a full refetch. One hour matches how long a session
// realistically keeps a list in memory, and is still short-lived.
export async function presignDownload(key, { expiresIn = 3600 } = {}) {
  if (!key) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export async function uploadBuffer(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** Existence + size + type, without downloading the object. */
export async function headObject(key) {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return {
      exists: true,
      size: r.ContentLength ?? 0,
      contentType: r.ContentType ?? null,
      etag: (r.ETag ?? "").replace(/"/g, ""),
    };
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") {
      return { exists: false, size: 0, contentType: null, etag: null };
    }
    throw e;
  }
}

/**
 * Read the first N bytes of an object. Used to re-run magic-byte validation on
 * a direct upload without pulling the whole file back through the function —
 * a ranged GET of 512 bytes costs effectively nothing.
 */
export async function getObjectHeadBytes(key, bytes = 512) {
  const r = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=0-${bytes - 1}` }),
  );
  const chunks = [];
  for await (const chunk of r.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function deleteObject(key) {
  if (!key) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
