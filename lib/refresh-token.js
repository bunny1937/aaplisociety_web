import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import RefreshToken from "@/models/RefreshToken";
function getRefreshSecret() {
  // Falls back to JWT_SECRET if a dedicated REFRESH_JWT_SECRET isn't set, so
  // this works without a new required env var — but configuring a distinct
  // secret is recommended (matches mobile-backend's convention) since it
  // lets refresh tokens be invalidated independently of access tokens.
  const secret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}
const REFRESH_TTL = "30d";
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
export async function issueRefreshToken(userId) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ userId: String(userId), jti }, getRefreshSecret(), { expiresIn: REFRESH_TTL });
  const { exp } = jwt.decode(token);
  await RefreshToken.create({ userId, jti, expiresAt: new Date(exp * 1000) });
  return token;
}
// Validates the presented refresh token against the stored, revocable
// record (not just the JWT signature — a signature-valid but revoked or
// already-rotated token must be rejected), then rotates it: the old jti is
// revoked and a new refresh token is issued. Returns null on any failure
// (expired, invalid signature, revoked, or the DB record missing/expired).
export async function rotateRefreshToken(oldToken) {
  let decoded;
  try {
    decoded = jwt.verify(oldToken, getRefreshSecret());
  } catch {
    return null;
  }
  const stored = await RefreshToken.findOne({ jti: decoded.jti, userId: decoded.userId });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) return null;
  // Revoke (not delete) — a revoked jti presented again later is a reuse
  // signal worth alerting on once this app has a monitoring layer.
  stored.revoked = true;
  await stored.save();
  const newToken = await issueRefreshToken(decoded.userId);
  return { userId: decoded.userId, refreshToken: newToken };
}
export async function revokeRefreshToken(token) {
  if (!token) return;
  try {
    const decoded = jwt.verify(token, getRefreshSecret());
    await RefreshToken.updateOne({ jti: decoded.jti }, { revoked: true });
  } catch {
    // already invalid/expired/unparseable — nothing to revoke
  }
}
export function setRefreshCookie(response, token) {
  response.cookies.set("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}
export function clearRefreshCookie(response) {
  response.cookies.set("refreshToken", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
