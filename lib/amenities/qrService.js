import crypto from "crypto";
import AmenityQrToken from "@/models/amenities/AmenityQrToken";
import AmenityQrScan from "@/models/amenities/AmenityQrScan";
import Amenity from "@/models/amenities/Amenity";
import { QR_MODE, QR_RESULT } from "./constants";

// QR issuing and validation.
//
// Security model: a printed QR sticker is a bearer credential, so only a SHA-256
// hash of the token is stored. The scannable string is returned exactly once, at
// generation time, and cannot be recovered afterwards — if the collection leaked,
// nobody could forge a check-in from it. `tokenPrefix` is a short, deliberately
// non-secret fragment kept for indexed lookup and for telling stickers apart in
// the scan log.
//
// Payload format:  AMN1:<amenityId>:<prefix>:<secret>
//   AMN1        version tag, so a future dynamic-QR format can coexist with
//               stickers already on walls
//   amenityId   lets the app show the amenity instantly, before the server round
//               trip — but it is NEVER trusted for authorisation; the server
//               resolves the amenity from the stored token
//   prefix      indexed lookup key
//   secret      the part that is hashed and verified

const PREFIX_LEN = 10;

function hashToken(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

export function parsePayload(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();

  // Accept the deep-link form too, so a camera app that opens the URL instead of
  // handing the string to the scanner still works.
  const linkMatch = value.match(/[?&]t=([^&\s]+)/);
  if (linkMatch) value = decodeURIComponent(linkMatch[1]);

  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "AMN1") return null;
  const [, amenityId, prefix, secret] = parts;
  if (!/^[a-f\d]{24}$/i.test(amenityId) || !prefix || !secret) return null;
  return { version: "AMN1", amenityId, prefix, secret, raw: value };
}

export async function generateToken({
  societyId, amenityId, mode = QR_MODE.STATIC, label, locationHint,
  rotationIntervalMins, expiresAt, generatedBy, generatedByName,
}) {
  const secret = crypto.randomBytes(24).toString("base64url");
  const prefix = crypto.randomBytes(8).toString("hex").slice(0, PREFIX_LEN);
  const token = `AMN1:${amenityId}:${prefix}:${secret}`;

  // Regenerating a poster does NOT retire the old one - that is revokeToken's
  // job, and the admin UI says so explicitly. Two live codes can be
  // intentional (a spare printed for a second entrance); silently killing the
  // old one here would surprise an admin who only asked for a new one.
  const doc = await AmenityQrToken.create({
    societyId,
    amenityId,
    tokenHash: hashToken(secret),
    tokenPrefix: prefix,
    mode,
    label: label || "",
    locationHint: locationHint || "",
    rotationIntervalMins: mode === QR_MODE.DYNAMIC ? rotationIntervalMins || 1440 : null,
    rotatesAt: mode === QR_MODE.DYNAMIC && rotationIntervalMins
      ? new Date(Date.now() + rotationIntervalMins * 60000)
      : null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    isActive: true,
    generatedBy: generatedBy || null,
    generatedByName: generatedByName || "",
  });

  // `token` is returned here and nowhere else, ever again.
  return { token, doc };
}

export async function revokeToken({ tokenId, userId }) {
  // Idempotent: revoking an already-revoked token must not move its
  // revokedAt timestamp forward, or a second accidental click rewrites the
  // audit trail of when the sticker actually stopped working.
  const already = await AmenityQrToken.findById(tokenId).select("isActive revokedAt revokedBy").lean();
  if (already && !already.isActive) return already;

  return AmenityQrToken.findByIdAndUpdate(
    tokenId,
    { $set: { isActive: false, revokedAt: new Date(), revokedBy: userId || null } },
    { new: true },
  );
}

// Validates a scanned payload. Returns a RESULT rather than throwing, because
// every outcome — including failure — is worth recording.
export async function verifyToken({ societyId, raw }) {
  const parsed = parsePayload(raw);
  if (!parsed) {
    return { ok: false, result: QR_RESULT.INVALID_TOKEN, token: null, parsed: null };
  }

  const token = await AmenityQrToken.findOne({ tokenPrefix: parsed.prefix }).lean();
  if (!token) {
    return { ok: false, result: QR_RESULT.INVALID_TOKEN, token: null, parsed };
  }

  // Constant-time comparison: a length-independent early-exit compare would leak
  // information about the stored hash across many attempts.
  const candidate = Buffer.from(hashToken(parsed.secret));
  const stored = Buffer.from(token.tokenHash);
  const matches = candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  if (!matches) {
    return { ok: false, result: QR_RESULT.INVALID_TOKEN, token, parsed };
  }

  // The amenityId embedded in the payload is never trusted for authorisation
  // (see file header), but a genuine secret pasted under a different
  // amenity's id in the payload is still a forgery attempt, not a fat-finger:
  // refuse it rather than silently resolving to the token's real amenity.
  if (String(token.amenityId) !== String(parsed.amenityId)) {
    return { ok: false, result: QR_RESULT.INVALID_TOKEN, token, parsed };
  }

  // Cross-society replay: a sticker photographed in one society must not work in
  // another, even though the hash is genuine.
  if (String(token.societyId) !== String(societyId)) {
    return { ok: false, result: QR_RESULT.WRONG_SOCIETY, token, parsed };
  }
  if (!token.isActive || token.revokedAt) {
    return { ok: false, result: QR_RESULT.REVOKED, token, parsed };
  }
  if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
    return { ok: false, result: QR_RESULT.EXPIRED, token, parsed };
  }

  const amenity = await Amenity.findById(token.amenityId).select("isDeleted").lean();
  if (!amenity || amenity.isDeleted) {
    return { ok: false, result: QR_RESULT.INVALID_TOKEN, token, parsed };
  }

  return { ok: true, result: QR_RESULT.VALID, token, parsed };
}

// Every attempt is logged, valid or not. Rejected scans are the only signal that
// a sticker has leaked, expired, or been shared as a photograph.
export async function recordScan({
  societyId, amenityId, tokenId, tokenPrefix, result, attendanceId,
  scannedBy, scannedByName, scannedByRole, memberId, deviceInfo, ip,
  locationHint, direction,
}) {
  try {
    const scan = await AmenityQrScan.create({
      societyId,
      amenityId: amenityId || null,
      tokenId: tokenId || null,
      tokenPrefix: tokenPrefix || "",
      result,
      direction: direction || null,
      attendanceId: attendanceId || null,
      scannedBy: scannedBy || null,
      scannedByName: scannedByName || "",
      scannedByRole: scannedByRole || "",
      memberId: memberId || null,
      deviceInfo: (deviceInfo || "").slice(0, 300),
      ip: ip || "",
      locationHint: locationHint || "",
      scannedAt: new Date(),
    });

    if (tokenId && result === QR_RESULT.VALID) {
      await AmenityQrToken.findByIdAndUpdate(tokenId, {
        $inc: { scanCount: 1 },
        $set: { lastScannedAt: new Date() },
      });
    }
    return scan;
  } catch (err) {
    console.error("[amenities] QR scan log failed", err?.message);
    return null;
  }
}

// What the admin screen renders on the printable sticker. `doc` is the saved
// Mongo record. `plaintext` is the secret string generateToken() just minted —
// only present right after generation, never again once this response is
// sent (it isn't persisted anywhere, so later reads of an existing token, via
// GET /api/amenities/[id], call this with plaintext omitted).
export function buildQrPayloadForDisplay(doc, plaintext = null) {
  return {
    _id: doc._id,
    amenityId: doc.amenityId,
    tokenPrefix: doc.tokenPrefix,
    mode: doc.mode,
    label: doc.label,
    locationHint: doc.locationHint,
    isActive: doc.isActive,
    expiresAt: doc.expiresAt,
    scanCount: doc.scanCount,
    lastScannedAt: doc.lastScannedAt,
    createdAt: doc.createdAt,
    ...(plaintext ? {
      token: plaintext,
      deepLink: `applisociety://amenities/checkin?t=${encodeURIComponent(plaintext)}`,
    } : {}),
    note: "The scannable code is shown only once when generated. Generate a new code if it has been lost.",
  };
}
