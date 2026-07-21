// Ported verbatim (logic-for-logic) from @aapli/business (mobile-backend
// shared-business package): payment allocation, escalation ladder, and
// billing math. Pure functions, no DB access.

function round2(n) {
  return parseFloat(n.toFixed(2));
}

// ── Payment allocation (interest-first) ──────────────────────────────────────
// Ported from aaplisoceity_web/utils/interestUtils.js allocatePaymentInterestFirst.
// Rules: clear interest across all given bills first (oldest-first / array
// order), then principal oldest-first. Overpayment becomes advanceCredit.
export function allocatePaymentInterestFirst(paymentAmount, bills, allocationMode = "INTEREST_FIRST") {
  let remaining = paymentAmount;
  let totalInterestCleared = 0;
  let totalPrincipalCleared = 0;
  const workBills = bills.map((b) => ({
    billId: b.billId,
    interestBalance: b.interestBalance || 0,
    principalBalance: b.principalBalance || 0,
    balanceAmount: b.balanceAmount || 0,
    totalAmount: b.totalAmount || 0,
    amountPaid: b.amountPaid || 0,
  }));
  function clearInterest() {
    for (const wb of workBills) {
      if (remaining <= 0) break;
      if (wb.interestBalance <= 0) continue;
      const clear = Math.min(remaining, wb.interestBalance);
      wb.interestBalance = round2(wb.interestBalance - clear);
      wb.balanceAmount = round2(wb.balanceAmount - clear);
      wb.amountPaid = round2(wb.amountPaid + clear);
      totalInterestCleared += clear;
      remaining = round2(remaining - clear);
    }
  }
  function clearPrincipal() {
    for (const wb of workBills) {
      if (remaining <= 0) break;
      if (wb.principalBalance <= 0) continue;
      const clear = Math.min(remaining, wb.principalBalance);
      wb.principalBalance = round2(wb.principalBalance - clear);
      wb.balanceAmount = round2(wb.balanceAmount - clear);
      wb.amountPaid = round2(wb.amountPaid + clear);
      totalPrincipalCleared += clear;
      remaining = round2(remaining - clear);
    }
  }
  if (allocationMode === "PRINCIPAL_FIRST") {
    clearPrincipal();
    clearInterest();
  } else {
    clearInterest();
    clearPrincipal();
  }
  const advanceCredit = round2(remaining);
  const billUpdates = workBills.map((wb) => {
    let newStatus;
    const balance = round2(wb.balanceAmount);
    if (balance <= 0.005) newStatus = "Paid";
    else if (wb.amountPaid > 0) newStatus = "Partial";
    else newStatus = "Unpaid";
    const original = bills.find((b) => String(b.billId) === String(wb.billId));
    return {
      billId: wb.billId,
      interestCleared: ((original?.interestBalance || 0) - wb.interestBalance).toFixed(2),
      principalCleared: ((original?.principalBalance || 0) - wb.principalBalance).toFixed(2),
      newInterestBalance: wb.interestBalance,
      newPrincipalBalance: wb.principalBalance,
      newBalanceAmount: wb.balanceAmount,
      newAmountPaid: wb.amountPaid,
      newStatus,
    };
  });
  return {
    billUpdates,
    totalInterestCleared: round2(totalInterestCleared),
    totalPrincipalCleared: round2(totalPrincipalCleared),
    advanceCredit,
    breakdown: {
      interestCleared: round2(totalInterestCleared),
      principalCleared: round2(totalPrincipalCleared),
      advanceCredit,
    },
  };
}

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

// ── Billing math (parity with lib/billing-engine.js) ─────────────────────────
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
