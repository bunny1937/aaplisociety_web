function normalizeBillCharges(rawCharges) {
  if (!rawCharges) return [];

  if (Array.isArray(rawCharges)) {
    return rawCharges.map((c) => ({
      name: c?.name || c?.headName || c?.description || "Charge",
      amount: Number(c?.amount ?? c?.value ?? 0),
      rate: c?.rate,
      perSqFt: Boolean(c?.perSqFt || c?.calculationType === "Per Sq Ft"),
      fixed: Boolean(c?.fixed || c?.calculationType === "Fixed"),
    }));
  }

  if (rawCharges instanceof Map) {
    return Array.from(rawCharges.entries()).map(([name, amount]) => ({
      name,
      amount: Number(amount ?? 0),
      rate: undefined,
      perSqFt: false,
      fixed: false,
    }));
  }

  if (typeof rawCharges === "object") {
    return Object.entries(rawCharges).map(([name, amount]) => ({
      name,
      amount: Number(amount ?? 0),
      rate: undefined,
      perSqFt: false,
      fixed: false,
    }));
  }

  return [];
}

module.exports = {
  normalizeBillCharges,
};
