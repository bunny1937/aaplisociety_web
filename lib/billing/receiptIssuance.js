import { newReceiptNo } from "@/lib/v1/billUtils";
import { allocateCommercialReceiptNo } from "@/lib/commercial/billNumbering";

// Single decision point for "which receipt number format" — used by every
// payment-recording path so residential vs commercial can never drift.
export async function issueReceiptNo(bill) {
  if (bill.billSeries === "COMMERCIAL") {
    return allocateCommercialReceiptNo(bill.societyId, bill.billYear, bill.billMonth + 1);
  }
  return newReceiptNo();
}
