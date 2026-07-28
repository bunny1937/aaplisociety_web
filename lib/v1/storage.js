// R2 / S3 object storage for the /v1 layer. Ported from mobile-backend
// src/services/storage.ts. Uses the same env vars as the web app's
// lib/tenant-storage.js (R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID /
// R2_SECRET_ACCESS_KEY).
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
//
// Visitor photos are operational data - useful for a week, evidence for a month,
// dead weight after that. Tenant documents are legal records and must be kept.
// Separating them by prefix is what lets you apply different retention to each.
//
// Backwards compatibility: existing objects keep their old keys, and reads use
// the key stored on the document (`visitor.photoKey`), so nothing breaks. Only
// newly uploaded objects land under the new layout. Old visitor photos will not
// be swept by the lifecycle rule - see the one-off note in CHANGES.md if you
// want to migrate or manually purge them.
export function buildKey(societyId, folder, ext) {
  return `${folder}/${societyId}/${randomUUID()}.${String(ext).replace(/^\./, "")}`;
}

export async function presignUpload(key, contentType) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn: 300 });
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
