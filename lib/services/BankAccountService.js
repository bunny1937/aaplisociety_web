import BankAccount from "@/models/BankAccount";
import ChartOfAccount from "@/models/ChartOfAccount";

export class BankAccountServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BankAccountServiceError";
    this.status = status;
  }
}

export async function createBankAccount(societyId, input, actorUserId) {
  const { bankName, accountNumber, ifscCode, branch, linkedAccountId } = input;
  if (!bankName || !accountNumber) throw new BankAccountServiceError(400, "bankName and accountNumber are required");
  if (!linkedAccountId) throw new BankAccountServiceError(400, "linkedAccountId is required");

  const account = await ChartOfAccount.findOne({ _id: linkedAccountId, societyId, isDeleted: false }).lean();
  if (!account) throw new BankAccountServiceError(404, "linkedAccountId does not exist in this society's Chart of Accounts");
  if (account.subType !== "Bank") {
    throw new BankAccountServiceError(422, `Account "${account.name}" has subType "${account.subType}" — a BankAccount must link to a Bank-subType account`);
  }

  return BankAccount.create({
    societyId,
    bankName,
    accountNumber,
    ifscCode,
    branch,
    linkedAccountId,
    createdBy: actorUserId,
  });
}

export async function listBankAccounts(societyId, { includeInactive } = {}) {
  const query = { societyId, isDeleted: false };
  if (!includeInactive) query.isActive = true;
  return BankAccount.find(query).sort({ bankName: 1 }).lean();
}

export async function getBankAccountById(societyId, id) {
  const bankAccount = await BankAccount.findOne({ _id: id, societyId, isDeleted: false }).lean();
  if (!bankAccount) throw new BankAccountServiceError(404, "Bank account not found");
  return bankAccount;
}
