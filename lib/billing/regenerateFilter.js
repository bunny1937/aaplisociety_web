export function transactionDeleteFilterForRegenerate(societyId, billPeriodId, billIds) {
  return {
    societyId,
    billPeriodId,
    type: "Debit",
    category: "Maintenance",
    referenceModel: "Bill",
    referenceId: { $in: billIds },
  };
}