import mongoose from "mongoose";
import Liability from "@/models/Liability";
import FinancialYear from "@/models/FinancialYear";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// Phase 2.12 of the accounting-system revamp (docs/accounting-system-ARD.md
// §3, §8): Liability Register — outstanding vendors, loans, deposits, advance
// collections, statutory taxes. Every ledger-affecting action goes through
// AccountingEngine.process() inside the same session as the Liability
// document write (§6.10, §9.2).

export class LiabilityServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "LiabilityServiceError";
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
    throw new LiabilityServiceError(
      409,
      "No Financial Year covers this date — create one before posting liability transactions.",
    );
  }
  return fy;
}

/**
 * Records a new liability and posts its incurrence (Dr contra account, e.g.
 * expense/asset/bank, Cr the liability account) as one transaction. The
 * contra account is caller-supplied because it varies by liability type — a
 * vendor bill debits an Expense/Asset account, a loan drawn debits Bank, an
 * advance collection debits Bank too but for a different reason.
 */
export async function incurLiability(societyId, input, actorUserId) {
  const {
    liabilityCode,
    name,
    type,
    description,
    partyType,
    partyRef,
    incurredDate,
    principalAmount,
    interestRate,
    dueDate,
    linkedLiabilityAccountId,
    contraAccountId,
    narration,
  } = input;

  if (!liabilityCode || !name) throw new LiabilityServiceError(400, "liabilityCode and name are required");
  if (!Liability.TYPES.includes(type)) {
    throw new LiabilityServiceError(400, `type must be one of ${Liability.TYPES.join(", ")}`);
  }
  if (!(Number(principalAmount) > 0)) throw new LiabilityServiceError(400, "principalAmount must be greater than zero");
  if (!linkedLiabilityAccountId || !contraAccountId) {
    throw new LiabilityServiceError(400, "linkedLiabilityAccountId and contraAccountId are both required");
  }
  if (partyType && !Liability.PARTY_TYPES.includes(partyType)) {
    throw new LiabilityServiceError(400, `partyType must be one of ${Liability.PARTY_TYPES.join(", ")}`);
  }
  if ((partyType && !partyRef) || (!partyType && partyRef)) {
    throw new LiabilityServiceError(400, "partyType and partyRef must be supplied together");
  }

  const date = incurredDate ? new Date(incurredDate) : new Date();
  const amount = round2(principalAmount);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const financialYear = await resolveFinancialYear(societyId, date, session);

      const [liability] = await Liability.create(
        [
          {
            societyId,
            liabilityCode,
            name,
            type,
            description,
            partyType: partyType || null,
            partyRef: partyRef || null,
            incurredDate: date,
            principalAmount: amount,
            outstandingAmount: amount,
            interestRate: interestRate ?? null,
            dueDate: dueDate ? new Date(dueDate) : null,
            linkedLiabilityAccountId,
            financialYearId: financialYear._id,
            createdBy: actorUserId,
          },
        ],
        { session },
      );

      const event = createAccountingEvent({
        type: EVENT_TYPES.LIABILITY_INCURRED,
        societyId,
        financialYearId: financialYear._id,
        sourceModule: "Liabilities",
        sourceRef: String(liability._id),
        actorUserId,
        idempotencyKey: `liability-incur:${liability._id}`,
        payload: {
          narration: narration || `Liability incurred: ${name} (${liabilityCode})`,
          date,
          partyType: partyType || undefined,
          partyRef: partyRef || undefined,
          lines: [
            { accountId: String(contraAccountId), side: "Debit", amount, narration: `Liability incurred: ${name}` },
            { accountId: String(linkedLiabilityAccountId), side: "Credit", amount, narration: `Liability: ${name}` },
          ],
        },
      });

      const posted = await engineProcess(event, { session });
      liability.incurredVoucherId = posted.voucher._id;
      await liability.save({ session });

      result = liability;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function listLiabilities(societyId, { status, type } = {}) {
  const query = { societyId, isDeleted: false };
  if (status) query.status = status;
  if (type) query.type = type;
  return Liability.find(query).sort({ incurredDate: -1 }).lean();
}

export async function getLiabilityById(societyId, id) {
  const liability = await Liability.findOne({ _id: id, societyId, isDeleted: false });
  if (!liability) throw new LiabilityServiceError(404, "Liability not found");
  return liability;
}

/**
 * Records a payment against a liability (Dr Liability, Cr the paying bank/
 * cash account), reducing outstandingAmount and closing the liability once
 * it reaches zero.
 */
export async function recordLiabilityPayment(societyId, liabilityId, { date, amount, payingAccountId, note } = {}, actorUserId) {
  if (!payingAccountId) throw new LiabilityServiceError(400, "payingAccountId is required");
  const paymentDate = date ? new Date(date) : new Date();
  const paidAmount = round2(amount);
  if (!(paidAmount > 0)) throw new LiabilityServiceError(400, "amount must be greater than zero");

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const liability = await Liability.findOne({ _id: liabilityId, societyId, isDeleted: false }).session(session);
      if (!liability) throw new LiabilityServiceError(404, "Liability not found");
      if (liability.status !== "Open") {
        throw new LiabilityServiceError(409, "This liability is already Closed");
      }
      if (paidAmount > liability.outstandingAmount + 0.005) {
        throw new LiabilityServiceError(
          422,
          `Payment (${paidAmount}) exceeds outstanding liability balance (${liability.outstandingAmount})`,
        );
      }

      const financialYear = await resolveFinancialYear(societyId, paymentDate, session);
      const paymentId = new mongoose.Types.ObjectId();

      const event = createAccountingEvent({
        type: EVENT_TYPES.LIABILITY_PAYMENT_MADE,
        societyId,
        financialYearId: financialYear._id,
        sourceModule: "Liabilities",
        sourceRef: String(liability._id),
        actorUserId,
        idempotencyKey: `liability-payment:${paymentId}`,
        payload: {
          narration: `Payment against liability: ${liability.name} (${liability.liabilityCode})`,
          date: paymentDate,
          lines: [
            { accountId: String(liability.linkedLiabilityAccountId), side: "Debit", amount: paidAmount, narration: `Liability paid: ${liability.name}` },
            { accountId: String(payingAccountId), side: "Credit", amount: paidAmount, narration: `Payment: ${liability.name}` },
          ],
        },
      });

      const posted = await engineProcess(event, { session });

      liability.outstandingAmount = round2(liability.outstandingAmount - paidAmount);
      if (liability.outstandingAmount <= 0.005) {
        liability.outstandingAmount = 0;
        liability.status = "Closed";
      }
      liability.payments.push({
        _id: paymentId,
        date: paymentDate,
        amount: paidAmount,
        payingAccountId,
        voucherId: posted.voucher._id,
        note,
      });
      await liability.save({ session });

      result = liability;
    });
    return result;
  } finally {
    await session.endSession();
  }
}
