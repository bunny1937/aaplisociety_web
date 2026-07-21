// Human-readable bill/receipt/transaction period label regardless of source
// field shape. Ported from mobile-backend src/lib/periodLabel.ts.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function periodLabelFrom(source) {
  if (source.billPeriodId && /^\d{4}-\d{2}$/.test(source.billPeriodId)) {
    const [year, month] = source.billPeriodId.split("-").map(Number);
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${year}`;
  }
  if (source.billYear && source.billMonth && source.billMonth >= 1 && source.billMonth <= 12) {
    return `${MONTHS[source.billMonth - 1]} ${source.billYear}`;
  }
  return source.title ?? source.period ?? "Bill";
}
