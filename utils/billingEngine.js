/**
 * billingEngine.js — Centralized billing calculation logic.
 *
 * All core billing math lives here. Import these functions from server routes
 * using `import { ... } from "@/utils/billingEngine"`.
 *
 * For client components (e.g. page.js), copy-paste the pure functions at the
 * top of the file since they have no server dependencies.
 *
 * DO NOT import React or any DB models here — this file must remain
 * server-compatible and side-effect-free.
 */

/**
 * Build a parking rates lookup from billing heads.
 * Source of truth is billing heads, NOT society.config.parkingRates.
 *
 * @param {Array} heads — array of BillingHead documents
 * @returns {Object} map of "Type-VehicleType" → defaultAmount
 *   e.g. { "Covered-Four-Wheeler": 500, "Open-Two-Wheeler": 200 }
 */
export function buildParkingRates(heads) {
  const parkingRates = {};
  heads.forEach((h) => {
    const hLower = h.headName?.trim().toLowerCase() || "";
    if (!hLower.includes("parking")) return;
    const typeMatch = ["covered", "open", "stilt"].find((t) =>
      hLower.includes(t),
    );
    const vehicleMatch = hLower.includes("four")
      ? "Four-Wheeler"
      : hLower.includes("two")
        ? "Two-Wheeler"
        : null;
    if (typeMatch && vehicleMatch) {
      const key = `${typeMatch.charAt(0).toUpperCase() + typeMatch.slice(1)}-${vehicleMatch}`;
      parkingRates[key] = h.defaultAmount;
    }
  });
  return parkingRates;
}

/**
 * Compute current-month charges for a single member.
 *
 * @param {Object} member — member document (needs carpetAreaSqft / builtUpAreaSqft / areaSqFt, parkingSlots)
 * @param {Array}  heads  — billing head documents (sorted by order)
 * @param {Object} parkingRates — output of buildParkingRates(heads)
 * @param {number} serviceTaxRate — percentage (0–100), 0 = no tax
 * @returns {{ charges, subtotal, serviceTax, currentBillTotal }}
 */
export function computeCurrentCharges(member, heads, parkingRates, serviceTaxRate) {
  const area = Number(
    member.carpetAreaSqft ?? member.builtUpAreaSqft ?? member.areaSqFt ?? 0,
  );
  const charges = [];
  let subtotal = 0;

  for (const head of heads) {
    if (!head.headName?.trim() || head.isActive === false) continue;
    const hLower = head.headName.trim().toLowerCase();
    const isParkingHead = hLower.includes("parking");
    if (isParkingHead) continue;

    let amount = 0;
    if (head.calculationType === "Per Sq Ft") {
      amount = area * head.defaultAmount;
    } else if (head.calculationType === "Percentage") {
      amount = (subtotal * head.defaultAmount) / 100;
    } else {
      // Fixed (default)
      amount = head.defaultAmount;
    }
    charges.push({
      name: head.headName,
      amount: parseFloat(amount.toFixed(2)),
    });
    subtotal += amount;
  }

  // Parking slots — skip Stilt and non-billable
  for (const slot of member.parkingSlots || []) {
    if (slot.type === "Stilt" || slot.monthlyBilling === false) continue;
    const key = `${slot.type}-${slot.vehicleType}`;
    const rate = parkingRates[key] ?? 0;
    if (rate > 0) {
      charges.push({
        name: `${slot.type} Parking - ${slot.vehicleType} (${slot.slotNumber})`,
        amount: rate,
      });
      subtotal += rate;
    }
  }

  const serviceTax =
    serviceTaxRate > 0
      ? parseFloat(((subtotal * serviceTaxRate) / 100).toFixed(2))
      : 0;
  const currentBillTotal = parseFloat((subtotal + serviceTax).toFixed(2));

  return {
    charges,
    subtotal: parseFloat(subtotal.toFixed(2)),
    serviceTax,
    currentBillTotal,
  };
}

/**
 * Compute previous principal and interest outstanding.
 *
 * Source of truth = balanceAmount on unpaid bills.
 * principalBalance field is immutable (gross at generation) — never use it directly.
 *
 * @param {Array}  unpaidBills   — unpaid/partial/overdue Bill documents
 * @param {Object|null} anyPriorBill — truthy if member had ANY prior bill (even fully paid)
 * @param {Object} memberOpening — { openingPrincipal, openingInterest } from Member document
 * @returns {{ principalOutstanding, interestOutstanding, totalBalance }}
 */
export function computePreviousBalances(unpaidBills, anyPriorBill, memberOpening) {
  if (unpaidBills.length > 0) {
    const principalOutstanding = unpaidBills.reduce((s, b) => {
      return s + Math.max(0, (b.balanceAmount || 0) - (b.interestBalance || 0));
    }, 0);
    const interestOutstanding = unpaidBills.reduce(
      (s, b) => s + (b.interestBalance || 0),
      0,
    );
    const totalBalance = unpaidBills.reduce(
      (s, b) => s + (b.balanceAmount || 0),
      0,
    );
    return {
      principalOutstanding: parseFloat(principalOutstanding.toFixed(2)),
      interestOutstanding: parseFloat(interestOutstanding.toFixed(2)),
      totalBalance: parseFloat(totalBalance.toFixed(2)),
    };
  }
  if (anyPriorBill) {
    return { principalOutstanding: 0, interestOutstanding: 0, totalBalance: 0 };
  }
  // New member — no bills ever generated, fall back to opening balances
  return {
    principalOutstanding: parseFloat(
      (memberOpening.openingPrincipal || 0).toFixed(2),
    ),
    interestOutstanding: parseFloat(
      (memberOpening.openingInterest || 0).toFixed(2),
    ),
    totalBalance: parseFloat(
      (
        (memberOpening.openingPrincipal || 0) +
        (memberOpening.openingInterest || 0)
      ).toFixed(2),
    ),
  };
}

/**
 * Compute this month's interest on the outstanding principal.
 *
 * @param {number} principalOutstanding — net principal owed (from computePreviousBalances)
 * @param {number} annualRate — annual interest rate as a percentage (e.g. 18 for 18%)
 * @returns {number} monthly interest amount, rounded to 2 decimal places
 */
export function computeMonthlyInterest(principalOutstanding, annualRate) {
  if (principalOutstanding <= 0 || annualRate <= 0) return 0;
  return parseFloat(((principalOutstanding * annualRate) / 1200).toFixed(2));
}

/**
 * Compute the grand total bill amounts.
 *
 * @param {Object} params
 * @param {number} params.principalOutstanding — from computePreviousBalances
 * @param {number} params.interestOutstanding  — from computePreviousBalances
 * @param {number} params.currInt              — from computeMonthlyInterest
 * @param {number} params.currentBillTotal     — from computeCurrentCharges
 * @param {number} params.advanceCredit        — member.advanceCredit
 * @returns {{ billPrincipal, billInterest, totalBillDue, advApplied, grandTotal }}
 */
export function computeBillTotal({
  principalOutstanding,
  interestOutstanding,
  currInt,
  currentBillTotal,
  advanceCredit,
}) {
  const billPrincipal = parseFloat(
    (principalOutstanding + currentBillTotal).toFixed(2),
  );
  const billInterest = parseFloat(
    (interestOutstanding + currInt).toFixed(2),
  );
  const totalBillDue = parseFloat((billPrincipal + billInterest).toFixed(2));
  const advApplied = parseFloat(
    Math.min(advanceCredit, totalBillDue).toFixed(2),
  );
  const grandTotal = parseFloat(
    Math.max(0, totalBillDue - advApplied).toFixed(2),
  );
  return { billPrincipal, billInterest, totalBillDue, advApplied, grandTotal };
}
