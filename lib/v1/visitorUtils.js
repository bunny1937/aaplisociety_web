// Visitor-pass helpers ported from mobile-backend visitors controller.
import crypto from "node:crypto";

export function sha256(v) {
  return crypto.createHash("sha256").update(String(v)).digest("hex");
}

// 6-digit numeric OTP (kept in plaintext on the pass for the resident to
// share, plus a hash for guard-side verification — parity with mobile).
export function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export function generateQrToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hhmmToMinutes(s) {
  const [h, m] = String(s || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Whether a pass may be used at `now`, considering status, window, recurrence
// and maxUses. Mirrors isPassUsableNow in the mobile controller.
export function isPassUsableNow(pass, now = new Date()) {
  if (!pass || pass.status !== "Active") return false;
  if (pass.validFrom && now < new Date(pass.validFrom)) return false;
  if (pass.expiresAt && now > new Date(pass.expiresAt)) return false;
  const uses = Array.isArray(pass.usedAt) ? pass.usedAt.length : 0;
  if (pass.maxUses && pass.maxUses > 0 && uses >= pass.maxUses) return false;
  if (pass.passType === "Recurring" || pass.passType === "Frequent") {
    const rec = pass.recurrence || {};
    if (Array.isArray(rec.days) && rec.days.length && !rec.days.includes(now.getDay())) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    if (rec.startTime && cur < hhmmToMinutes(rec.startTime)) return false;
    if (rec.endTime && cur > hhmmToMinutes(rec.endTime)) return false;
  }
  return true;
}
