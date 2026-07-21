/**
 * CENTRAL INTEREST UTILITY — v2 (Interest-Satisfy-First)
 * Monthly-only. No DAILY. No SIMPLE/COMPOUND config.
 * interestRate=0 → bypass all logic.
 */
/**
 * roundInterest — society rounding config.
 * TWO_DECIMAL: 10.256 → 10.26  (standard 2dp rounding)
 * ROUND_UP:    10.251 → 10.26  (ceiling to 2 decimal places, never loses a paisa)
 * ROUND_UP_INT: 10.001 → 11   (ceiling to nearest whole rupee)
 */
export function roundInterest(value, mode = "TWO_DECIMAL") {
  if (!value || value <= 0) return 0;
  if (mode === "ROUND_UP_INT") return Math.ceil(value);
  if (mode === "ROUND_UP")
    return Math.ceil(Math.round(value * 100000) / 1000) / 100;
  return parseFloat(value.toFixed(2));
}
/**
 * calculateMonthlyInterest — single source of truth.
 *
 * @param {number} remainingPrincipal — unpaid principal this bill
 * @param {number} remInt             — carried unpaid interest from prev periods
 * @param {number} annualRate         — society annual rate (e.g. 21)
 * @param {number} gracePeriodDays
 * @param {Date}   billDueDate        — due date of THIS bill month
 * @param {Date}   referenceDate      — generation date (1st of billing month)
 * @param {string} interestRounding   — 'TWO_DECIMAL' | 'ROUND_UP'
 * @returns {{ currInt, monthInterest, remInt }}
 *   currInt       = interest on principal this month (0 if paid before grace)
 *   monthInterest = currInt + remInt (total interest on this bill)
 *   remInt        = monthInterest (carried forward if not cleared)
 */
export function calculateMonthlyInterest({
  remainingPrincipal,
  remInt = 0,
  annualRate,
  // gracePeriodDays, interestAfterDays, billDueDate, referenceDate, interestTriggerTiming — removed
  interestRounding = "TWO_DECIMAL",
}) {
  // interestRate = 0 → bypass
  if (!annualRate || annualRate <= 0) {
    return { currInt: 0, monthInterest: 0, remInt: 0 };
  }
  // No principal → carry remInt only
  if (!remainingPrincipal || remainingPrincipal <= 0) {
    const carried = roundInterest(remInt || 0, interestRounding);
    return { currInt: 0, monthInterest: carried, remInt: carried };
  }
  // Simple monthly interest: principal * annualRate / 1200
  // Always applies when prevRemPrincipal > 0 — no grace period gate
  const currInt = roundInterest(
    (remainingPrincipal * annualRate) / 1200,
    interestRounding,
  );
  const totalMonthInterest = roundInterest(
    (remInt || 0) + currInt,
    interestRounding,
  );
  return {
    currInt,
    monthInterest: totalMonthInterest,
    remInt: totalMonthInterest,
  };
}
/**
 * getBillPayFinalDate — interest cap date for a bill month.
 */
export function getBillPayFinalDate(billYear, billMonth, billPayFinalDay) {
  if (!billPayFinalDay || billPayFinalDay <= 0) return null;
  // billMonth is 1-based from callers. JS Date month is 0-based.
  const lastDay = new Date(billYear, billMonth, 0).getDate(); // day-0 of next month = last day of billMonth
  const clampedDay = Math.min(billPayFinalDay, lastDay);
  return new Date(billYear, billMonth - 1, clampedDay, 23, 59, 59, 999);
}
/**
 * getOldestDueDate — anchor date for interest.
 */
export function getOldestDueDate(unpaidBills, billDueDay, refYear, refMonth) {
  if (unpaidBills && unpaidBills.length > 0) {
    const oldest = unpaidBills[0];
    if (oldest.dueDate) return new Date(oldest.dueDate);
    return new Date(oldest.billYear, oldest.billMonth, billDueDay || 10);
  }
  let prevYear = refYear;
  let prevMonth = refMonth - 1;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  return new Date(prevYear, prevMonth - 1, billDueDay || 10);
}
/**
 * calculateInterestAmount — backwards-compat wrapper.
 * Callers that haven't migrated still work.
 */
export function calculateInterestAmount(
  principal,
  _oldestDueDate,
  _referenceDate,
  _gracePeriodDays,
  interestRate,
  _ignoredMethod,
  _ignoredCapDate,
  interestRounding = "TWO_DECIMAL",
) {
  if (!principal || principal <= 0) {
    return {
      interestAmount: 0,
      interestDays: 0,
      effectiveDays: 0,
      chargeableMonths: 0,
    };
  }
  const { monthInterest } = calculateMonthlyInterest({
    remainingPrincipal: principal,
    remInt: 0,
    annualRate: interestRate || 0,
    interestRounding,
  });
  return {
    interestAmount: monthInterest,
    interestDays: 0,
    effectiveDays: 0,
    chargeableMonths: monthInterest > 0 ? 1 : 0,
  };
}
/**
 * allocatePaymentInterestFirst — CORE ENGINE.
 *
 * Takes a payment amount and list of unpaid bills (oldest-first).
 * Returns updated bill payment state + advance credit.
 *
 * Rules:
 *  1. Clear all interest across all bills first (oldest-first).
 *  2. Then clear principal oldest-first.
 *  3. Overpayment → advanceCredit.
 *
 * @param {number} paymentAmount
 * @param {Array}  bills  — sorted oldest-first, each: { _id, interestBalance, principalBalance, balanceAmount, totalAmount, amountPaid }
 * @returns {{
 *   billUpdates: Array<{ billId, interestCleared, principalCleared, newInterestBalance, newPrincipalBalance, newBalanceAmount, newAmountPaid, newStatus }>,
 *   totalInterestCleared: number,
 *   totalPrincipalCleared: number,
 *   advanceCredit: number,
 *   breakdown: { interestCleared, principalCleared, advanceCredit }
 * }}
 */
export function allocatePaymentInterestFirst(
  paymentAmount,
  bills,
  allocationMode = "INTEREST_FIRST", // INTEREST_FIRST | PRINCIPAL_FIRST
) {
  let remaining = parseFloat(paymentAmount);
  let totalInterestCleared = 0;
  let totalPrincipalCleared = 0;
  // Deep clone to avoid mutating originals.
  const workBills = bills.map((b) => ({
    billId: b._id,
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
      wb.interestBalance = parseFloat((wb.interestBalance - clear).toFixed(2));
      wb.balanceAmount = parseFloat((wb.balanceAmount - clear).toFixed(2));
      wb.amountPaid = parseFloat((wb.amountPaid + clear).toFixed(2));
      totalInterestCleared += clear;
      remaining = parseFloat((remaining - clear).toFixed(2));
    }
  }
  function clearPrincipal() {
    for (const wb of workBills) {
      if (remaining <= 0) break;
      if (wb.principalBalance <= 0) continue;
      const clear = Math.min(remaining, wb.principalBalance);
      wb.principalBalance = parseFloat(
        (wb.principalBalance - clear).toFixed(2),
      );
      wb.balanceAmount = parseFloat((wb.balanceAmount - clear).toFixed(2));
      wb.amountPaid = parseFloat((wb.amountPaid + clear).toFixed(2));
      totalPrincipalCleared += clear;
      remaining = parseFloat((remaining - clear).toFixed(2));
    }
  }
  if (allocationMode === "PRINCIPAL_FIRST") {
    clearPrincipal();
    clearInterest();
  } else {
    // INTEREST_FIRST (default)
    clearInterest();
    clearPrincipal();
  }
  // previousBalance is DISPLAY-ONLY — not cleared here.
  const advanceCredit = parseFloat(remaining.toFixed(2));
  const billUpdates = workBills.map((wb) => {
    let newStatus;
    const balance = parseFloat(wb.balanceAmount.toFixed(2));
    if (balance <= 0.005)
      newStatus = "Paid"; // ₹0.005 epsilon for float precision
    else if (wb.amountPaid > 0) newStatus = "Partial";
    else newStatus = "Unpaid";
    return {
      billId: wb.billId,
      interestCleared: parseFloat(
        (bills.find((b) => String(b._id) === String(wb.billId))
          ?.interestBalance || 0) - wb.interestBalance,
      ).toFixed(2),
      principalCleared: parseFloat(
        (bills.find((b) => String(b._id) === String(wb.billId))
          ?.principalBalance || 0) - wb.principalBalance,
      ).toFixed(2),
      newInterestBalance: wb.interestBalance,
      newPrincipalBalance: wb.principalBalance,
      newPreviousBalance: wb.previousBalance,
      newBalanceAmount: wb.balanceAmount,
      newAmountPaid: wb.amountPaid,
      newStatus,
    };
  });
  return {
    billUpdates,
    totalInterestCleared: parseFloat(totalInterestCleared.toFixed(2)),
    totalPrincipalCleared: parseFloat(totalPrincipalCleared.toFixed(2)),
    advanceCredit,
    breakdown: {
      interestCleared: parseFloat(totalInterestCleared.toFixed(2)),
      principalCleared: parseFloat(totalPrincipalCleared.toFixed(2)),
      advanceCredit,
    },
  };
}
