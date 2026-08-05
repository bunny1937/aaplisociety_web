import { unitClassForMember } from "./constants";

const NON_OCCUPANCY_CAP = 0.10; // Bombay HC Mar 2007 / Maharashtra GR Aug 2001 —
// non-occupancy charge <= 10% of service charges, never higher, regardless of
// what a society's own bye-laws or admin input specify.

export function calculateCommercialCharges(member, commercialHeads, opts = {}) {
  const nonOccupancyCharged = opts.nonOccupancyCharged === true;
  const unitClass = unitClassForMember(member); // "Shop" | "Office" | "Residential"
  const area = Number(member.carpetAreaSqft || member.builtUpAreaSqft || member.areaSqFt || 0);

  const applicable = (commercialHeads || []).filter(
    (h) => h.isActive !== false && Array.isArray(h.categoryScope) && h.categoryScope.includes(unitClass),
  );

  const breakdown = {};
  let serviceChargeTotal = 0;
  let runningBase = 0;
  for (const head of applicable) {
    const rate = Number(head.rate?.[unitClass]) || 0;
    let amount = 0;
    if (head.calculationType === "Per Sq Ft") amount = area * rate;
    else if (head.calculationType === "Percentage") amount = runningBase * (rate / 100);
    else amount = rate; // Fixed

    amount = parseFloat(amount.toFixed(2));
    breakdown[head.headName] = amount;
    runningBase += amount;
    if (head.isServiceCharge) serviceChargeTotal += amount;
  }

  if (nonOccupancyCharged && serviceChargeTotal > 0) {
    breakdown["Non-Occupancy Charge"] = parseFloat((serviceChargeTotal * NON_OCCUPANCY_CAP).toFixed(2));
  }

  const subtotal = parseFloat(
    Object.values(breakdown).reduce((s, v) => s + v, 0).toFixed(2),
  );
  return { breakdown, subtotal };
}
