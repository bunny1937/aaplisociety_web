import mongoose from "mongoose";
import Fund from "@/models/Fund";
import ChartOfAccount from "@/models/ChartOfAccount";
import FinancialYear from "@/models/FinancialYear";
import { getAccountLedger } from "@/lib/services/GeneralLedgerService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// Phase 2.13 of the accounting-system revamp (docs/accounting-system-ARD.md
// §3, §8): Fund Management. See models/Fund.js for why balances are computed
// live from the General Ledger rather than cached on the Fund document.

export class FundServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FundServiceError";
    this.status = status;
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function resolveFinancialYear(societyId, date, session) {
  const fy = await FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).session(session);
  if (!fy) {
    throw new FundServiceError(
      409,
      "No Financial Year covers this date — create one before posting fund transactions.",
    );
  }
  return fy;
}

/** Live balance for one fund: the linked account's current GL closing balance. */
export async function getFundBalance(societyId, fund) {
  const ledger = await getAccountLedger(societyId, fund.linkedAccountId);
  return ledger.closingSide === "Cr" ? ledger.closingBalance : -ledger.closingBalance;
}

async function decorateWithBalance(societyId, funds) {
  return Promise.all(
    funds.map(async (f) => ({ ...f, balance: await getFundBalance(societyId, f) })),
  );
}

export async function createFund(societyId, input, actorUserId) {
  const { fundCode, name, fundType, linkedAccountId, purpose, targetAmount, minimumBalance } = input;
  if (!fundCode || !name) throw new FundServiceError(400, "fundCode and name are required");
  if (!Fund.FUND_TYPES.includes(fundType)) {
    throw new FundServiceError(400, `fundType must be one of ${Fund.FUND_TYPES.join(", ")}`);
  }
  if (!linkedAccountId) throw new FundServiceError(400, "linkedAccountId is required");

  const account = await ChartOfAccount.findOne({ _id: linkedAccountId, societyId, isDeleted: false }).lean();
  if (!account) throw new FundServiceError(404, "linkedAccountId does not exist in this society's Chart of Accounts");
  if (account.type !== "Equity") {
    throw new FundServiceError(422, `Account "${account.name}" is type "${account.type}" — a Fund must link to an Equity-type account`);
  }

  const fund = await Fund.create({
    societyId,
    fundCode,
    name,
    fundType,
    linkedAccountId,
    purpose,
    targetAmount: targetAmount ?? null,
    minimumBalance: minimumBalance ?? 0,
    createdBy: actorUserId,
  });
  return fund;
}

export async function listFunds(societyId, { fundType } = {}) {
  const query = { societyId, isDeleted: false };
  if (fundType) query.fundType = fundType;
  const funds = await Fund.find(query).sort({ name: 1 }).lean();
  return decorateWithBalance(societyId, funds);
}

export async function getFundById(societyId, id) {
  const fund = await Fund.findOne({ _id: id, societyId, isDeleted: false }).lean();
  if (!fund) throw new FundServiceError(404, "Fund not found");
  const balance = await getFundBalance(societyId, fund);
  return { ...fund, balance };
}

async function postFundMovement(societyId, { date, lines, narration }, actorUserId) {
  const movementDate = date ? new Date(date) : new Date();
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const financialYear = await resolveFinancialYear(societyId, movementDate, session);
      const event = createAccountingEvent({
        type: EVENT_TYPES.RESERVE_TRANSFER,
        societyId,
        financialYearId: financialYear._id,
        sourceModule: "Funds",
        actorUserId,
        payload: { narration, date: movementDate, lines },
      });
      result = await engineProcess(event, { session });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/** Cash/asset contribution into a fund: Dr contra (e.g. Bank), Cr fund account. */
export async function contributeToFund(societyId, fundId, { contraAccountId, amount, date, note } = {}, actorUserId) {
  if (!contraAccountId) throw new FundServiceError(400, "contraAccountId is required");
  const amt = round2(amount);
  if (!(amt > 0)) throw new FundServiceError(400, "amount must be greater than zero");

  const fund = await Fund.findOne({ _id: fundId, societyId, isDeleted: false }).lean();
  if (!fund) throw new FundServiceError(404, "Fund not found");

  const posted = await postFundMovement(
    societyId,
    {
      date,
      narration: note || `Contribution to fund: ${fund.name}`,
      lines: [
        { accountId: String(contraAccountId), side: "Debit", amount: amt, narration: `Contribution to ${fund.name}` },
        { accountId: String(fund.linkedAccountId), side: "Credit", amount: amt, narration: `Fund contribution: ${fund.name}` },
      ],
    },
    actorUserId,
  );
  return { fund, voucher: posted.voucher, journalEntry: posted.journalEntry };
}

/** Drawdown from a fund: Dr fund account, Cr contra (e.g. Bank/vendor payable). Blocked below minimumBalance. */
export async function withdrawFromFund(societyId, fundId, { contraAccountId, amount, date, note } = {}, actorUserId) {
  if (!contraAccountId) throw new FundServiceError(400, "contraAccountId is required");
  const amt = round2(amount);
  if (!(amt > 0)) throw new FundServiceError(400, "amount must be greater than zero");

  const fund = await Fund.findOne({ _id: fundId, societyId, isDeleted: false }).lean();
  if (!fund) throw new FundServiceError(404, "Fund not found");

  const balance = await getFundBalance(societyId, fund);
  if (round2(balance - amt) < fund.minimumBalance - 0.005) {
    throw new FundServiceError(
      422,
      `Withdrawal would take "${fund.name}" below its minimum balance (current: ${balance}, minimum: ${fund.minimumBalance})`,
    );
  }

  const posted = await postFundMovement(
    societyId,
    {
      date,
      narration: note || `Drawdown from fund: ${fund.name}`,
      lines: [
        { accountId: String(fund.linkedAccountId), side: "Debit", amount: amt, narration: `Fund drawdown: ${fund.name}` },
        { accountId: String(contraAccountId), side: "Credit", amount: amt, narration: `Drawdown from ${fund.name}` },
      ],
    },
    actorUserId,
  );
  return { fund, voucher: posted.voucher, journalEntry: posted.journalEntry };
}

/** Appropriation between two funds: Dr fromFund, Cr toFund. Blocked if fromFund would drop below minimumBalance. */
export async function transferBetweenFunds(societyId, { fromFundId, toFundId, amount, date, note } = {}, actorUserId) {
  if (!fromFundId || !toFundId) throw new FundServiceError(400, "fromFundId and toFundId are required");
  if (String(fromFundId) === String(toFundId)) throw new FundServiceError(400, "fromFundId and toFundId must differ");
  const amt = round2(amount);
  if (!(amt > 0)) throw new FundServiceError(400, "amount must be greater than zero");

  const [fromFund, toFund] = await Promise.all([
    Fund.findOne({ _id: fromFundId, societyId, isDeleted: false }).lean(),
    Fund.findOne({ _id: toFundId, societyId, isDeleted: false }).lean(),
  ]);
  if (!fromFund) throw new FundServiceError(404, "Source fund not found");
  if (!toFund) throw new FundServiceError(404, "Destination fund not found");

  const fromBalance = await getFundBalance(societyId, fromFund);
  if (round2(fromBalance - amt) < fromFund.minimumBalance - 0.005) {
    throw new FundServiceError(
      422,
      `Transfer would take "${fromFund.name}" below its minimum balance (current: ${fromBalance}, minimum: ${fromFund.minimumBalance})`,
    );
  }

  const posted = await postFundMovement(
    societyId,
    {
      date,
      narration: note || `Transfer: ${fromFund.name} → ${toFund.name}`,
      lines: [
        { accountId: String(fromFund.linkedAccountId), side: "Debit", amount: amt, narration: `Transfer out to ${toFund.name}` },
        { accountId: String(toFund.linkedAccountId), side: "Credit", amount: amt, narration: `Transfer in from ${fromFund.name}` },
      ],
    },
    actorUserId,
  );
  return { fromFund, toFund, voucher: posted.voucher, journalEntry: posted.journalEntry };
}
