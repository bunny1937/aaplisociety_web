/**
 * excelValidator.js — pure validation for bill and payment Excel templates.
 * No DB calls. All DB lookups happen in the route; pass pre-fetched sets here.
 */

const PAYMENT_METHODS = new Set(["Cash", "Cheque", "Online", "NEFT", "UPI"]);

/**
 * validateBillRows — validate bill generation template rows.
 *
 * @param {object[]} rows         — parsed Excel rows (1 object per row)
 * @param {object}   opts
 * @param {Set}      opts.validMemberIds   — Set of valid memberID strings from DB
 * @param {string}   opts.billPeriodId     — expected e.g. "2026-05"
 * @param {string[]} opts.expectedColumns  — mandatory column names
 *
 * @returns {{ gridRows, summary: { valid, warning, error } }}
 */
export function validateBillRows(rows, { validMemberIds, billPeriodId, expectedColumns = [] }) {
  const [expectedYear, expectedMonthStr] = billPeriodId.split("-");
  const expectedMonth = parseInt(expectedMonthStr);

  const seenMemberIds = new Map();
  const gridRows = [];

  const SKIP_COLS = new Set(["MemberId", "Wing", "FlatNo", "OwnerName", "Month", "Year", "DueDate", "PreviousBalance", "InterestDue", "GrandTotal"]);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const cells = {};
    let rowStatus = "valid";

    const markCell = (col, value, status, message) => {
      cells[col] = { value, status, message };
      if (status === "error" && rowStatus !== "error") rowStatus = "error";
      if (status === "warning" && rowStatus === "valid") rowStatus = "warning";
    };
    const okCell = (col, value) => { cells[col] = { value, status: "valid" }; };

    // MemberId
    const memberId = String(raw["MemberId"] || "").trim();
    if (!memberId) {
      markCell("MemberId", memberId, "error", "MemberId is required");
    } else if (!validMemberIds.has(memberId)) {
      markCell("MemberId", memberId, "error", "Unknown member ID — not in DB");
    } else if (seenMemberIds.has(memberId)) {
      markCell("MemberId", memberId, "error", `Duplicate row — already seen at row ${seenMemberIds.get(memberId)}`);
      rowStatus = "error";
    } else {
      seenMemberIds.set(memberId, rowNum);
      okCell("MemberId", memberId);
    }

    // Month
    const month = parseInt(raw["Month"]);
    if (isNaN(month) || month !== expectedMonth) {
      markCell("Month", raw["Month"], "error", `Month must be ${expectedMonth}`);
    } else {
      okCell("Month", month);
    }

    // Year
    const year = parseInt(raw["Year"]);
    if (isNaN(year) || year !== parseInt(expectedYear)) {
      markCell("Year", raw["Year"], "error", `Year must be ${expectedYear}`);
    } else {
      okCell("Year", year);
    }

    // Numeric charge columns
    for (const col of Object.keys(raw)) {
      if (SKIP_COLS.has(col) || cells[col]) continue;
      const val = parseFloat(raw[col]);
      if (isNaN(val)) {
        markCell(col, raw[col], "warning", "Expected a number — defaulting to 0");
      } else if (val < 0) {
        markCell(col, val, "warning", "Negative charge — is this intentional?");
      } else {
        okCell(col, val);
      }
    }

    // Fill skip cols as-is
    for (const col of SKIP_COLS) {
      if (!cells[col] && raw[col] !== undefined) okCell(col, raw[col]);
    }

    // Ensure all expected columns present
    for (const col of expectedColumns) {
      if (!cells[col]) markCell(col, "", "error", `Column "${col}" missing from this row`);
    }

    gridRows.push({ rowNum, status: rowStatus, cells });
  }

  const summary = {
    valid: gridRows.filter((r) => r.status === "valid").length,
    warning: gridRows.filter((r) => r.status === "warning").length,
    error: gridRows.filter((r) => r.status === "error").length,
  };

  return { gridRows, summary };
}

/**
 * validatePaymentRows — validate payment collection template rows.
 *
 * @param {object[]} rows
 * @param {object}   opts
 * @param {Set}      opts.validMemberIds       — Set<string>
 * @param {Map}      opts.existingBillMap       — Map<memberId, { balanceAmount, status }>
 * @param {Date}     opts.today                — for future-date check
 *
 * @returns {{ gridRows, summary, validPayments: object[] }}
 */
export function validatePaymentRows(rows, { validMemberIds, existingBillMap, today }) {
  const seenMemberIds = new Map();
  const gridRows = [];
  const validPayments = [];

  const REF_COLS = ["Wing","FlatNo","OwnerName","DueDate","OpeningPrincipal","OpeningInterest","CurrentCharges","CurrentInterest","BillPrincipal","BillInterest","TotalBillDue","AlreadyPaid","RemainingDue","BillStatus","LastReceiptNo","LastPaymentDate"];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;
    const cells = {};
    let rowStatus = "valid";

    const markCell = (col, value, status, message) => {
      cells[col] = { value, status, message };
      if (status === "error" && rowStatus !== "error") rowStatus = "error";
      if (status === "warning" && rowStatus === "valid") rowStatus = "warning";
    };
    const okCell = (col, value) => { cells[col] = { value, status: "valid" }; };

    // MemberId
    const memberId = String(raw["MemberId"] || "").trim();
    if (!memberId) {
      markCell("MemberId", memberId, "error", "MemberId is required");
    } else if (!validMemberIds.has(memberId)) {
      markCell("MemberId", memberId, "error", "Unknown member ID");
    } else if (seenMemberIds.has(memberId)) {
      markCell("MemberId", memberId, "error", `Duplicate — already at row ${seenMemberIds.get(memberId)}`);
    } else {
      seenMemberIds.set(memberId, rowNum);
      okCell("MemberId", memberId);
    }

    okCell("Month", raw["Month"]);
    okCell("Year", raw["Year"]);

    // AmountPaid
    const amountStr = String(raw["AmountPaid"] || "").trim();
    const amount = parseFloat(amountStr);
    if (!amountStr) {
      markCell("AmountPaid", amountStr, "error", "AmountPaid is required");
    } else if (isNaN(amount) || amount <= 0) {
      markCell("AmountPaid", amountStr, "error", `Invalid amount: ${amountStr} — must be > 0`);
    } else {
      const bill = existingBillMap?.get(memberId);
      const remaining = bill?.balanceAmount ?? Infinity;
      if (amount > remaining + 0.01) {
        markCell("AmountPaid", amount, "warning", `Paying ₹${amount} but only ₹${remaining.toFixed(2)} remaining — overpayment`);
      } else {
        okCell("AmountPaid", amount);
      }
    }

    // PaymentMethod
    const method = String(raw["PaymentMethod"] || "").trim();
    if (!method) {
      markCell("PaymentMethod", method, "error", "PaymentMethod is required");
    } else if (!PAYMENT_METHODS.has(method)) {
      markCell("PaymentMethod", method, "error", `Invalid method "${method}" — use: ${[...PAYMENT_METHODS].join(", ")}`);
    } else {
      okCell("PaymentMethod", method);
    }

    // PaymentDate
    const dateStr = String(raw["PaymentDate"] || "").trim();
    if (!dateStr) {
      markCell("PaymentDate", dateStr, "error", "PaymentDate is required");
    } else {
      let parsedDate = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        parsedDate = new Date(dateStr);
      } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [dd, mm, yyyy] = dateStr.split("-");
        parsedDate = new Date(`${yyyy}-${mm}-${dd}`);
      }
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        markCell("PaymentDate", dateStr, "error", "Invalid date format — use YYYY-MM-DD or DD-MM-YYYY");
      } else if (parsedDate > (today || new Date())) {
        markCell("PaymentDate", dateStr, "error", "Future payment date not allowed");
      } else {
        okCell("PaymentDate", dateStr);
      }
    }

    okCell("Remarks", raw["Remarks"] || "");

    for (const col of REF_COLS) {
      if (!cells[col]) okCell(col, raw[col] ?? "");
    }

    gridRows.push({ rowNum, status: rowStatus, cells });
    if (rowStatus !== "error") {
      validPayments.push({ ...raw, _rowNum: rowNum, _parsedAmount: parseFloat(raw["AmountPaid"]) });
    }
  }

  const summary = {
    valid: gridRows.filter((r) => r.status === "valid").length,
    warning: gridRows.filter((r) => r.status === "warning").length,
    error: gridRows.filter((r) => r.status === "error").length,
  };

  return { gridRows, summary, validPayments };
}
