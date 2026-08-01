import mongoose from "mongoose";
import JournalEntry from "@/models/JournalEntry";
import JournalLine from "@/models/JournalLine";
import Voucher from "@/models/Voucher";
import FinancialYear from "@/models/FinancialYear";
import {
  createDraftVoucherWithinSession,
  markVoucherPosted,
  markVoucherReversed,
} from "@/lib/services/VoucherService";
import { persistJournalEntry } from "@/lib/accounting/journal/JournalPoster.js";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap"; // ensures the engine seams are registered

export class JournalEntryServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "JournalEntryServiceError";
    this.status = status;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listJournalEntries(societyId, { financialYearId, status, sourceModule } = {}) {
  const query = { societyId };
  if (financialYearId) query.financialYearId = financialYearId;
  if (status) query.status = status;
  if (sourceModule) query.sourceModule = sourceModule;
  return JournalEntry.find(query).sort({ date: -1, createdAt: -1 }).lean();
}

export async function getJournalEntry(societyId, id) {
  const entry = await JournalEntry.findOne({ _id: id, societyId }).lean();
  if (!entry) throw new JournalEntryServiceError(404, "Journal entry not found");
  const lines = await JournalLine.find({ journalEntryId: entry._id }).lean();
  return { ...entry, lines };
}

// ── Manual journal voucher (first real Accounting Engine producer) ───────────

/**
 * Posts a manual journal voucher. The user supplies the lines; this builds a
 * ManualAdjustment AccountingEvent and runs it through AccountingEngine.process
 * — so even manual entries go through the one posting path (no route ever
 * writes a JournalEntry directly, §6.10). The engine enforces balance and
 * account validity before anything commits.
 *
 * @param {Array} lines [{ accountId, side, amount, partyType?, partyRef?, narration? }]
 */
export async function postManualJournal(
  societyId,
  { financialYearId, date, narration, lines, idempotencyKey },
  actorUserId,
) {
  if (!financialYearId) throw new JournalEntryServiceError(400, "financialYearId is required");
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new JournalEntryServiceError(400, "At least two journal lines are required");
  }
  const event = createAccountingEvent({
    type: EVENT_TYPES.MANUAL_ADJUSTMENT,
    societyId,
    financialYearId,
    sourceModule: "Manual",
    actorUserId,
    idempotencyKey,
    payload: { lines, narration, date },
  });
  return engineProcess(event);
}

// ── Reversal ─────────────────────────────────────────────────────────────────

/**
 * Reverses a Posted voucher by creating a NEW offsetting voucher + journal
 * entry with every debit/credit flipped (§6.7 — reversal never mutates the
 * original's amounts). The original is marked Reversed and linked to its
 * reversal. Both entries remain in the ledger and net to zero. Reversal does
 * not go through AccountingEngine.process because it's a mechanical inverse of
 * an existing balanced entry, not a rule-driven posting — but it uses the same
 * VoucherService/JournalPoster primitives and the same transaction guarantees.
 */
export async function reverseVoucher(societyId, voucherId, { reason, actorUserId }) {
  if (!reason || !reason.trim()) {
    throw new JournalEntryServiceError(400, "A reason is required to reverse a voucher");
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const original = await Voucher.findOne({ _id: voucherId, societyId, isDeleted: false }).session(session);
      if (!original) throw new JournalEntryServiceError(404, "Voucher not found");
      if (original.status !== "Posted") {
        throw new JournalEntryServiceError(409, `Only a Posted voucher can be reversed (current status: ${original.status})`);
      }

      const originalEntry = await JournalEntry.findOne({ voucherId: original._id, societyId }).session(session);
      if (!originalEntry) throw new JournalEntryServiceError(422, "Original voucher has no journal entry to reverse");
      const originalLines = await JournalLine.find({ journalEntryId: originalEntry._id }).session(session).lean();

      const financialYear = await FinancialYear.findOne({
        _id: original.financialYearId,
        societyId,
        isDeleted: false,
      }).session(session);
      if (!financialYear) throw new JournalEntryServiceError(404, "Financial Year not found");
      if (!financialYear.isPostable()) {
        throw new JournalEntryServiceError(
          409,
          `Financial Year "${financialYear.label}" is Locked — voucher cannot be reversed into it`,
        );
      }

      // New offsetting voucher.
      const reversalVoucher = await createDraftVoucherWithinSession(session, {
        societyId,
        financialYearId: financialYear._id,
        voucherType: original.voucherType,
        date: new Date(),
        narration: `Reversal of ${original.voucherNumber}: ${reason}`,
        sourceModule: original.sourceModule,
        sourceRef: original.sourceRef,
        createdBy: actorUserId,
        financialYear,
      });
      reversalVoucher.reversalOfVoucherId = original._id;
      await reversalVoucher.save({ session });

      // Flip every line.
      const flippedLines = originalLines.map((l) => ({
        accountId: l.accountId,
        side: l.side === "Debit" ? "Credit" : "Debit",
        amount: l.amount,
        partyType: l.partyType,
        partyRef: l.partyRef,
        narration: `Reversal: ${l.narration || ""}`.trim(),
      }));

      const reversalEntry = await persistJournalEntry({
        session,
        societyId,
        financialYear,
        voucher: reversalVoucher,
        lines: flippedLines,
        sourceModule: original.sourceModule,
        sourceRef: original.sourceRef,
        status: "Posted",
        reversalOfJournalEntryId: originalEntry._id,
        createdBy: actorUserId,
      });

      await markVoucherPosted(reversalVoucher._id, reversalEntry._id, session);
      await markVoucherReversed(original._id, reversalVoucher._id, session);

      // Original entry + lines become Reversed (they still count toward
      // balances — the reversal offsets them; see JournalEntry.BALANCE_STATUSES).
      originalEntry.status = "Reversed";
      originalEntry.reversedByJournalEntryId = reversalEntry._id;
      await originalEntry.save({ session });
      await JournalLine.updateMany(
        { journalEntryId: originalEntry._id },
        { $set: { status: "Reversed" } },
        { session },
      );

      result = { reversalVoucher, reversalEntry };
    });
    return result;
  } finally {
    await session.endSession();
  }
}
