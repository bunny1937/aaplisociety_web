// Ported verbatim (logic-for-logic) from @aapli/business (mobile-backend
// shared-business package): payment allocation, escalation ladder, and
// billing math. Pure functions, no DB access.

function round2(n) {
  return parseFloat(n.toFixed(2));
}

// ── Payment allocation (interest-first) ──────────────────────────────────────
// Re-exported from the canonical implementation (utils/interestUtils.js) as of
// Phase 2.1 of the accounting-system revamp (see docs/accounting-system-ARD.md
// §4 conflict 3 / §9.1). This used to be a separate, hand-ported copy of the
// same algorithm — now there is exactly one implementation, so web and mobile
// can never silently diverge. utils/interestUtils.js is a pure, side-effect-free
// module (no DB access), so importing it here does not change lib/v1's
// no-DB-access contract.
export { allocatePaymentInterestFirst } from "../../utils/interestUtils.js";

// ── Visitor escalation ladder ────────────────────────────────────────────────
export const VISITOR_ESCALATION_LADDER = [
  { level: 1, afterSeconds: 0, channels: ["in_app", "push"] },
  { level: 2, afterSeconds: 60, channels: ["push", "sms"] },
  { level: 3, afterSeconds: 180, channels: ["whatsapp", "guard_call"] },
  { level: 4, afterSeconds: 300, channels: ["admin_alert"] },
];

export function nextEscalation(currentLevel) {
  return VISITOR_ESCALATION_LADDER.find((l) => l.level === currentLevel + 1) ?? null;
}

// ── Billing math ──────────────────────────────────────────────────────────────
// NOT CURRENTLY CALLED ANYWHERE IN THIS REPO (verified via repo-wide grep,
// 2026-07-30) — no v1 route wires this in yet. Despite the original "parity
// with lib/billing-engine.js" comment, it is NOT equivalent to the web
// interest formula: this gates on a grace period (daysOverdue >
// interestAfterDays) and uses rate/100 directly, while the canonical web path
// (utils/interestUtils.js calculateMonthlyInterest, used by
// lib/billing-engine.js) has no grace-period gate and uses annualRate/1200.
// Do not wire this into a live route without first reconciling it against
// calculateMonthlyInterest — see docs/accounting-system-ARD.md §9 Phase 2.1.
export function computeBill(i) {
  const principalBase = i.openingPrincipal + i.currentCharges;
  const chargeInterest =
    i.daysOverdue > i.interestAfterDays
      ? round2(principalBase * (i.interestRatePctPerMonth / 100))
      : 0;
  const currentInterest = round2(i.openingInterest + chargeInterest);
  const totalBillDue = round2(principalBase + currentInterest);
  return {
    currentInterest,
    totalBillDue,
    closingPrincipal: round2(principalBase),
    closingInterest: currentInterest,
    closingTotal: totalBillDue,
  };
}

export function financialYear(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  return m >= 3 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
