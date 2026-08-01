import crypto from "crypto";
import BankStatementLine from "@/models/BankStatementLine";
import { getBankAccountById, BankAccountServiceError } from "@/lib/services/BankAccountService";
import { parseBankStatementExcel } from "@/lib/accounting/bankStatementExcel";

export class BankStatementServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BankStatementServiceError";
    this.status = status;
  }
}

/** Parses an uploaded bank statement Excel file and bulk-inserts its lines, tagged with one importBatchId. */
export async function importBankStatement(societyId, bankAccountId, buffer, actorUserId) {
  await getBankAccountById(societyId, bankAccountId); // throws 404 if not found/wrong society

  const parsed = await parseBankStatementExcel(buffer);
  if (!parsed.success) {
    throw new BankStatementServiceError(422, parsed.error + (parsed.details ? `: ${parsed.details.join("; ")}` : ""));
  }
  if (parsed.lines.length === 0) {
    throw new BankStatementServiceError(422, "No valid statement lines found in the file");
  }

  const importBatchId = `imp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const docs = parsed.lines.map((l) => ({
    societyId,
    bankAccountId,
    date: l.date,
    description: l.description,
    refNo: l.refNo,
    amount: l.amount,
    type: l.type,
    importBatchId,
  }));
  await BankStatementLine.insertMany(docs);

  return {
    importBatchId,
    imported: docs.length,
    rowErrors: parsed.rowErrors,
    skipped: parsed.rowErrors.length,
  };
}

export async function listStatementLines(societyId, bankAccountId, { matchStatus, importBatchId } = {}) {
  const query = { societyId, bankAccountId, isDeleted: false };
  if (matchStatus) query.matchStatus = matchStatus;
  if (importBatchId) query.importBatchId = importBatchId;
  return BankStatementLine.find(query).sort({ date: -1 }).lean();
}
