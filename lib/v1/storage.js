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

// Keys are always tenant-scoped: societyId/<folder>/<uuid>.<ext>
export function buildKey(societyId, folder, ext) {
  return `${societyId}/${folder}/${randomUUID()}.${String(ext).replace(/^\./, "")}`;
}

export async function presignUpload(key, contentType) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn: 300 });
}

export async function presignDownload(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 600 });
}

export async function uploadBuffer(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}
