/**
 * Calculates per-member charges correctly.
 * Parking heads are matched against member.parkingSlots — not applied blindly.
 * Mirrors the logic in billing-config livePreview and generate-bills generatePreview.
 */
export function calculateMemberCharges(member, heads) {
  const area = Number(
    member.carpetAreaSqft || member.builtUpAreaSqft || member.areaSqFt || 0,
  );
  const slots = (member.parkingSlots || []).filter(
    (s) => s.type !== "Stilt" && s.monthlyBilling !== false,
  );

  const breakdown = {};
  let runningBase = 0;

  for (const head of heads) {
    if (!head.headName?.trim() || head.isActive === false) continue;

    const headLower = head.headName.trim().toLowerCase();
    const isParkingHead =
      headLower.includes("parking") ||
      headLower.includes("two-wheeler") ||
      headLower.includes("four-wheeler") ||
      headLower.includes("two wheeler") ||
      headLower.includes("four wheeler");

    const rate = parseFloat(head.defaultAmount) || 0;
    let amount = 0;

    if (isParkingHead && head.calculationType === "Fixed") {
      // Count how many of this member's slots match this head
      const matchingCount = slots.filter((slot) => {
        const slotType = slot.type?.toLowerCase() || "";
        const slotVehicle = slot.vehicleType?.toLowerCase() || "";
        const vehicleNormalized = slotVehicle
          .replace(/-/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        // Must match BOTH type AND vehicle — OR logic causes false positives
        // e.g. "open parking - four wheeler" falsely matches Open Two-Wheeler via slotType="open"
        return (
          headLower.includes(slotType) &&
          (headLower.includes(vehicleNormalized) ||
            headLower.includes(slotVehicle))
        );
      }).length;

      amount = matchingCount > 0 ? rate * matchingCount : 0;
    } else if (head.calculationType === "Per Sq Ft") {
      amount = area * rate;
    } else if (head.calculationType === "Percentage") {
      amount = runningBase * (rate / 100);
    } else {
      // Fixed, non-parking
      amount = rate;
    }

    breakdown[head.headName] = parseFloat(amount.toFixed(2));
    runningBase += amount;
  }

  const subtotal = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { breakdown, subtotal: parseFloat(subtotal.toFixed(2)) };
}
