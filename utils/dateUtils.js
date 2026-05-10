// utils/dateUtils.js
/**
 * Build a Date from year/month/day config values.
 * Clamps day to the actual last day of that month so e.g.
 * day=31 in February becomes Feb 28/29, never March 2.
 * @param {number} year
 * @param {number} month  1-based (Jan=1, Dec=12)
 * @param {number} day    society config value (billDueDay etc.)
 * @param {number} hh hours (default 0)
 * @param {number} mm minutes (default 0)
 * @param {number} ss seconds (default 0)
 * @returns {Date}
 */
export function safeConfigDate(year, month, day, hh = 0, mm = 0, ss = 0) {
  const lastDay = new Date(year, month, 0).getDate(); // day-0 of next month = last day of this month
  const clamped = Math.min(Math.max(1, day || 1), lastDay);
  return new Date(year, month - 1, clamped, hh, mm, ss, 0);
}

export function getFinancialYear(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-based
  return m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
