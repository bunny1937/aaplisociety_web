import ExcelJS from "exceljs";

// Phase 2.14 (docs/accounting-system-ARD.md §6.4, §2.4): each new import type
// gets its own generate/validate/parse trio — lib/excel-handler.js is
// per-entity, not schema-generic (confirmed in the ARD's codebase findings).
// This follows the exact generate→validate→preview→confirm shape used
// elsewhere (lib/excel-handler.js's member import) rather than inventing a
// new import mechanism.

const REQUIRED_COLUMNS = ["date", "description", "amount", "type"];

export async function generateBankStatementTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Bank Statement");
  worksheet.columns = [
    { header: "date", key: "date", width: 14 },
    { header: "description", key: "description", width: 40 },
    { header: "refNo", key: "refNo", width: 18 },
    { header: "amount", key: "amount", width: 14 },
    { header: "type", key: "type", width: 10 },
  ];
  worksheet.addRow({});
  const noteRow = worksheet.addRow({
    date: "NOTE: date format YYYY-MM-DD. type must be Debit or Credit (as it appears on the bank statement, i.e. money leaving/entering the bank account).",
  });
  noteRow.font = { italic: true, color: { argb: "FF6B7280" } };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  return workbook.xlsx.writeBuffer();
}

export function validateBankStatementStructure(headers) {
  const errors = [];
  REQUIRED_COLUMNS.forEach((col) => {
    if (!headers.includes(col)) errors.push(`Missing required column: "${col}"`);
  });
  return { isValid: errors.length === 0, errors, headers };
}

export async function parseBankStatementExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  const parsePromise = workbook.xlsx.load(buffer);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("File parsing timeout")), 30000));
  await Promise.race([parsePromise, timeoutPromise]);

  if (workbook.worksheets.length === 0) {
    return { success: false, error: "Excel file is empty or corrupted" };
  }
  const worksheet = workbook.worksheets[0];
  if (worksheet.rowCount > 5001) {
    return { success: false, error: "File too large. Maximum 5000 statement lines allowed per upload." };
  }
  if (worksheet.rowCount < 2) {
    return { success: false, error: "Excel sheet is empty. Please add statement lines below the headers." };
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell((cell) => {
    const v = String(cell.value || "").trim().toLowerCase();
    if (v) headers.push(v);
  });
  const structure = validateBankStatementStructure(headers);
  if (!structure.isValid) {
    return { success: false, error: "Excel structure validation failed", details: structure.errors };
  }
  const columnMap = {};
  headers.forEach((h, i) => (columnMap[h] = i + 1));

  const lines = [];
  const rowErrors = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const getCell = (col) => {
      const idx = columnMap[col];
      if (!idx) return "";
      const cell = row.getCell(idx);
      if (cell.value instanceof Date) return cell.value;
      return String(cell.value ?? "").trim();
    };
    const dateRaw = getCell("date");
    const description = getCell("description");
    const refNo = getCell("refNo");
    const amountRaw = getCell("amount");
    const typeRaw = getCell("type");
    if (!dateRaw && !description && !amountRaw && !typeRaw) return; // skip fully blank row

    const errors = [];
    const date = dateRaw instanceof Date ? dateRaw : new Date(dateRaw);
    if (!dateRaw || Number.isNaN(date.getTime())) errors.push("date is invalid");
    const amount = parseFloat(amountRaw);
    if (!(amount > 0)) errors.push("amount must be a positive number");
    const type = String(typeRaw).trim();
    if (!["Debit", "Credit"].includes(type)) errors.push('type must be "Debit" or "Credit"');

    if (errors.length > 0) {
      rowErrors.push({ row: rowNumber, errors });
      return;
    }
    lines.push({ date, description, refNo, amount: Math.round(amount * 100) / 100, type });
  });

  return { success: true, lines, rowErrors, totalRows: lines.length + rowErrors.length };
}
