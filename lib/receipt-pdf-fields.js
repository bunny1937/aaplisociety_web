// Shared field-mapping logic for filling an uploaded PDF/image receipt
// template with a member's real receipt data. Mirrors lib/bill-pdf-fields.js
// but with the receipt's own field vocabulary (receipt number, payer, amount
// paid, payment date/mode, etc. — a Receipt document has a different shape
// than a Bill). Used by BOTH the real receipt-download route
// (app/api/member/receipts/[id]/download/route.js) and the admin's sample
// preview route (app/api/receipt-template/preview-fill/route.js) so what the
// admin confirms is exactly what members receive.
function formatMoney(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function formatDateForPdf(dateValue) {
  return new Date(dateValue).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
// Builds { formFieldData, overlayData } for FlexiblePDFGenerator's
// generateGenericOverlay (PDF) / generateImageOverlay (image).
export function buildReceiptFillData({ receipt, bill, society, member }) {
  const overlayData = {
    companyName: society?.name || "",
    receiptNumber: receipt.receiptNo || "",
    payerName: member?.ownerName || "",
    payerAddress: `${member?.wing || ""}-${member?.flatNo || ""}`,
    payerPhone: member?.contactNumber || "",
    amountPaid: formatMoney(receipt.amount),
    paymentDate: formatDateForPdf(receipt.paidAt),
    paymentMode: receipt.paymentMode || "",
    transactionId: receipt.transactionId || "",
    billPeriod: receipt.billPeriodId || bill?.billPeriodId || "",
    previousBalance: formatMoney(receipt.previousBalanceSnapshot ?? bill?.previousBalance ?? 0),
  };
  const formFieldData = {
    "Company name": society?.name || "",
    "Receipt number": receipt.receiptNo || "",
    "Receipt number_af_date": receipt.receiptNo || "",
    "Payer name": member?.ownerName || "",
    "Payer address": `${member?.wing || ""}-${member?.flatNo || ""}`,
    "Payer phone": member?.contactNumber || "",
    "Amount paid": Number(receipt.amount || 0).toFixed(2),
    "Payment date_af_date": formatDateForPdf(receipt.paidAt),
    "Payment mode": receipt.paymentMode || "",
    "Transaction ID": receipt.transactionId || "",
    "Bill period": receipt.billPeriodId || bill?.billPeriodId || "",
  };
  return { overlayData, formFieldData };
}
// Overlay field keys the admin can position on an uploaded receipt PDF/image
// with no fillable form fields — exactly the keys buildReceiptFillData()
// above populates in overlayData, so nothing configured here can silently
// do nothing.
export const RECEIPT_OVERLAY_FIELD_KEYS = [
  { key: "companyName", label: "Society name" },
  { key: "receiptNumber", label: "Receipt number" },
  { key: "payerName", label: "Payer / member name" },
  { key: "payerAddress", label: "Flat / address" },
  { key: "payerPhone", label: "Payer phone" },
  { key: "amountPaid", label: "Amount paid" },
  { key: "paymentDate", label: "Payment date" },
  { key: "paymentMode", label: "Payment mode" },
  { key: "transactionId", label: "Transaction ID" },
  { key: "billPeriod", label: "Bill period" },
  { key: "previousBalance", label: "Previous balance" },
];
