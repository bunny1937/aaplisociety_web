import ChartOfAccount from "@/models/ChartOfAccount";

export class ChartOfAccountServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ChartOfAccountServiceError";
    this.status = status;
  }
}

export async function createAccount({
  societyId,
  code,
  name,
  type,
  subType,
  scheduleCode,
  parentAccountId,
  description,
  createdBy,
}) {
  if (!code || !name || !type) {
    throw new ChartOfAccountServiceError(400, "code, name, and type are required");
  }
  if (!ChartOfAccount.TYPES.includes(type)) {
    throw new ChartOfAccountServiceError(400, `type must be one of: ${ChartOfAccount.TYPES.join(", ")}`);
  }
  if (parentAccountId) {
    const parent = await ChartOfAccount.findOne({ _id: parentAccountId, societyId, isDeleted: false });
    if (!parent) {
      throw new ChartOfAccountServiceError(400, "parentAccountId does not exist in this society's Chart of Accounts");
    }
    if (parent.type !== type) {
      throw new ChartOfAccountServiceError(
        400,
        `Parent account "${parent.name}" is type "${parent.type}" — a child account must share its parent's type`,
      );
    }
  }
  const existing = await ChartOfAccount.findOne({ societyId, code, isDeleted: false }).lean();
  if (existing) {
    throw new ChartOfAccountServiceError(409, `Account code "${code}" already exists`);
  }
  const account = await ChartOfAccount.create({
    societyId,
    code,
    name,
    type,
    subType,
    scheduleCode,
    parentAccountId: parentAccountId || null,
    description,
    createdBy,
  });
  return account;
}

export async function listAccounts(societyId, { type, isActive, includeInactive } = {}) {
  const query = { societyId, isDeleted: false };
  if (type) query.type = type;
  if (!includeInactive) query.isActive = isActive === undefined ? true : isActive;
  return ChartOfAccount.find(query).sort({ code: 1 }).lean();
}

export async function getAccountById(societyId, id) {
  const account = await ChartOfAccount.findOne({ _id: id, societyId, isDeleted: false });
  if (!account) throw new ChartOfAccountServiceError(404, "Account not found");
  return account;
}

export async function updateAccount(societyId, id, patch) {
  const account = await getAccountById(societyId, id);
  if (account.isLocked) {
    throw new ChartOfAccountServiceError(409, "Account is locked and cannot be edited");
  }
  // type is intentionally not patchable here — changing an account's
  // double-entry classification after it may already have posted Journal
  // Entries against it is an accounting-integrity hazard, not a simple edit.
  const patchable = ["name", "subType", "scheduleCode", "description"];
  for (const key of patchable) {
    if (patch[key] !== undefined) account[key] = patch[key];
  }
  await account.save();
  return account;
}

export async function setAccountActive(societyId, id, isActive) {
  const account = await getAccountById(societyId, id);
  if (account.isLocked) {
    throw new ChartOfAccountServiceError(409, "Account is locked and cannot be (de)activated");
  }
  account.isActive = isActive;
  await account.save();
  return account;
}

export async function setAccountLocked(societyId, id, isLocked) {
  const account = await getAccountById(societyId, id);
  account.isLocked = isLocked;
  await account.save();
  return account;
}
