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
 * @param {Map}      opts.wingFlatMap      — Map of "wing-flatno" → member object
 * @param {string}   opts.billPeriodId     — expected e.g. "2026-05"
 * @param {string[]} opts.expectedColumns  — mandatory column names
 *
 * @returns {{ gridRows, summary: { valid, warning, error } }}
 */
export function validateBillRows(rows, { wingFlatMap, billPeriodId, expectedColumns = [] }) {
  const seenFlats = new Map();
  const gridRows = [];

  const SKIP_COLS = new Set(["Wing", "FlatNo", "OwnerName", "Period", "Month", "Year", "DueDate", "OpeningPrincipal", "OpeningInterest", "CurrentInterest", "BillPrincipal", "BillInterest", "TotalBillDue", "AlreadyPaid", "RemainingDue", "BillStatus", "AmountPaid", "PaymentMethod", "PaymentDate", "Remarks", "PreviousBalance", "InterestDue", "GrandTotal"]);

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

    const wing = String(raw["Wing"] || "").trim();
    const flatNo = String(raw["FlatNo"] || "").trim();
    const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;

    // Skip instruction row
    if (wing.startsWith("⚠") || (!wing && !flatNo)) continue;

    // Wing + FlatNo validation
    if (!wing || !flatNo) {
      markCell("Wing", wing, "error", "Wing is required");
      markCell("FlatNo", flatNo, "error", "FlatNo is required");
    } else if (wingFlatMap && !wingFlatMap[flatKey]) {
      markCell("Wing", wing, "error", `Flat "${wing}-${flatNo}" not found in system`);
      markCell("FlatNo", flatNo, "error", "");
    } else if (seenFlats.has(flatKey)) {
      markCell("Wing", wing, "error", `Duplicate — already seen at row ${seenFlats.get(flatKey)}`);
      markCell("FlatNo", flatNo, "error", "");
    } else {
      seenFlats.set(flatKey, rowNum);
      okCell("Wing", wing);
      okCell("FlatNo", flatNo);
    }

    // Period
    const period = String(raw["Period"] || "").trim();
    if (billPeriodId && period && period !== billPeriodId) {
      markCell("Period", period, "error", `Period must be ${billPeriodId}`);
    } else {
      okCell("Period", period || billPeriodId);
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
 * @param {Map}      opts.wingFlatMap        — Map<"wing-flatno", member>
 * @param {Map}      opts.existingBillMap    — Map<"wing-flatno", { balanceAmount }>
 * @param {Date}     opts.today             — for future-date check
 *
 * @returns {{ gridRows, summary, validPayments: object[] }}
 */
export function validatePaymentRows(rows, { wingFlatMap, existingBillMap, today }) {
  const seenFlats = new Map();
  const gridRows = [];
  const validPayments = [];

  const REF_COLS = ["OwnerName","DueDate","OpeningPrincipal","OpeningInterest","CurrentCharges","CurrentInterest","BillPrincipal","BillInterest","TotalBillDue","AlreadyPaid","RemainingDue","BillStatus"];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2;

    const wing = String(raw["Wing"] || "").trim();
    const flatNo = String(raw["FlatNo"] || "").trim();

    // Skip instruction row
    if (wing.startsWith("⚠") || (!wing && !flatNo)) continue;
    // Skip rows with no payment
    const _amtRaw = String(raw["AmountPaid"] ?? "").trim();
    if (!_amtRaw) continue;

    const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;

    const cells = {};
    let rowStatus = "valid";

    const markCell = (col, value, status, message) => {
      cells[col] = { value, status, message };
      if (status === "error" && rowStatus !== "error") rowStatus = "error";
      if (status === "warning" && rowStatus === "valid") rowStatus = "warning";
    };
    const okCell = (col, value) => { cells[col] = { value, status: "valid" }; };

    // Wing + FlatNo
    if (!wing || !flatNo) {
      markCell("Wing", wing, "error", "Wing is required");
      markCell("FlatNo", flatNo, "error", "FlatNo is required");
    } else if (wingFlatMap && !wingFlatMap.get(flatKey)) {
      markCell("Wing", wing, "error", `Flat "${wing}-${flatNo}" not found`);
      markCell("FlatNo", flatNo, "error", "");
    } else if (seenFlats.has(flatKey)) {
      markCell("Wing", wing, "error", `Duplicate — already at row ${seenFlats.get(flatKey)}`);
      markCell("FlatNo", flatNo, "error", "");
    } else {
      seenFlats.set(flatKey, rowNum);
      okCell("Wing", wing);
      okCell("FlatNo", flatNo);
    }

    // Period
    if (raw["Period"]) {
      okCell("Period", raw["Period"]);
    } else {
      okCell("Month", raw["Month"]);
      okCell("Year", raw["Year"]);
    }

    // AmountPaid
    const amountStr = String(raw["AmountPaid"] || "").trim();
    const amount = parseFloat(amountStr);
    if (!amountStr) {
      markCell("AmountPaid", amountStr, "error", "AmountPaid is required");
    } else if (isNaN(amount) || amount <= 0) {
      markCell("AmountPaid", amountStr, "error", `Invalid amount: ${amountStr} — must be > 0`);
    } else {
      const bill = existingBillMap?.get(flatKey);
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

    // PaymentDate — handle JS Date (cellDates:true), XLSX serial, YYYY-MM-DD, DD-MM-YYYY
    const rawDate = raw["PaymentDate"];
    const dateStr = String(rawDate ?? "").trim();
    if (!dateStr || dateStr === "Invalid Date") {
      markCell("PaymentDate", "", "error", "PaymentDate is required");
    } else {
      let parsedDate = null;
      if (rawDate instanceof Date) {
        parsedDate = rawDate;
      } else if (typeof rawDate === "number") {
        // XLSX serial: days since 1899-12-30
        parsedDate = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        parsedDate = new Date(dateStr);
      } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
        const [dd, mm, yyyy] = dateStr.split("-");
        parsedDate = new Date(`${yyyy}-${mm}-${dd}`);
      }
      const displayDate = parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString().split("T")[0]
        : dateStr;
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        markCell("PaymentDate", displayDate, "error", "Invalid date format — use YYYY-MM-DD or DD-MM-YYYY");
      } else if (parsedDate > (today || new Date())) {
        markCell("PaymentDate", displayDate, "error", "Future payment date not allowed");
      } else {
        okCell("PaymentDate", displayDate);
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
