// lib/billing/ledgerSignature.js
//
// Anti-tamper for the Collections grid.
//
// The four ledger columns the admin sees (Bill Due, Opening Due, Current
// Charges, Remaining Due) are computed ONCE on the server and never trusted
// from the client again. Every sheet row is stamped with an HMAC of the values
// that must not move. On verify, the server recomputes the HMAC. If a single
// paisa of any locked column changed in the browser, the signature will not
// match and the row is rejected before it can touch a Bill document.
//
// This is the reason the client is allowed to hold the ledger at all. Without
// it we would have to re-query every row on submit, which is exactly the N+1
// we just removed from billing/preview.

import crypto from "crypto";

const SECRET =
  process.env.LEDGER_SIGNING_SECRET ||
  process.env.JWT_SECRET ||
  process.env.ADMIN_SECRET_KEY ||
  "";

if (!SECRET) {
  console.warn(
    "[ledgerSignature] No LEDGER_SIGNING_SECRET / JWT_SECRET found. Row signing is disabled and the grid will refuse to submit.",
  );
}

/** Money is compared at 2dp. Never compare raw floats. */
export function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * The exact tuple that is locked. Order matters; changing it invalidates every
 * signature already in flight, which is intentional if billing config changes.
 */
function canonical(row, fingerprint) {
  return [
    String(row.billId || ""),
    String(row.memberId || ""),
    String(row.periodId || ""),
    money(row.openingDue).toFixed(2),
    money(row.currentCharges).toFixed(2),
    money(row.billDue).toFixed(2),
    money(row.remainingDue).toFixed(2),
    money(row.alreadyPaid).toFixed(2),
    String(row.systemStatus || ""),
    String(fingerprint || ""),
  ].join("|");
}

export function signRow(row, fingerprint) {
  if (!SECRET) return "";
  return crypto
    .createHmac("sha256", SECRET)
    .update(canonical(row, fingerprint))
    .digest("base64url");
}

export function verifyRow(row, fingerprint, signature) {
  if (!SECRET) return false;
  const expected = signRow(row, fingerprint);
  if (!expected || !signature) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Billing-config fingerprint.
 *
 * The whole point of "generated once and locked forever unless billing config
 * changes" is that we need a cheap way to detect that change. This hashes
 * everything that can move a number in the ledger. It goes into every row
 * signature, so the instant an admin edits a billing head or the interest
 * rate, every cached sheet in every open tab becomes invalid and the client is
 * told to refetch.
 */
export function configFingerprint({ config = {}, heads = [] }) {
  const parts = [
    String(config.interestRate ?? ""),
    String(config.interestAfterDays ?? ""),
    String(config.serviceTaxRate ?? ""),
    String(config.billDueDay ?? ""),
    String(config.maintenanceRate ?? ""),
    String(config.sinkingFundRate ?? ""),
    String(config.repairFundRate ?? ""),
    JSON.stringify(config.fixedCharges ?? {}),
    heads
      .filter((h) => h.isActive !== false)
      .map(
        (h) =>
          `${h._id}:${h.headName}:${h.calculationType}:${money(h.defaultAmount)}`,
      )
      .sort()
      .join(","),
  ];
  return crypto
    .createHash("sha256")
    .update(parts.join("||"))
    .digest("base64url")
    .slice(0, 22);
}
