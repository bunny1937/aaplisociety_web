import CommercialNumberSequence from "@/models/CommercialNumberSequence";

async function allocate(societyId, year, month, series, session) {
  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const seq = await CommercialNumberSequence.findOneAndUpdate(
    { societyId, periodKey, series },
    { $inc: { lastNumber: 1 } },
    { upsert: true, new: true, session },
  );
  const padded = String(seq.lastNumber).padStart(4, "0");
  return `COM/${year}/${String(month).padStart(2, "0")}/${padded}`;
}

export function allocateCommercialBillNo(societyId, year, month, session) {
  return allocate(societyId, year, month, "BILL", session);
}

export function allocateCommercialReceiptNo(societyId, year, month, session) {
  return allocate(societyId, year, month, "RECEIPT", session);
}
