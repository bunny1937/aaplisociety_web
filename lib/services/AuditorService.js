import mongoose from "mongoose";
import Voucher from "@/models/Voucher";
import JournalLine from "@/models/JournalLine";
import JournalAuditTrail from "@/models/JournalAuditTrail";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// Phase 2.19 of the accounting-system revamp (docs/accounting-system-ARD.md
// §5.1, §8): Auditor Mode. Read-only by default — the only write surface is
// createAdjustment(), which requires a mandatory reason and posts through
// AccountingEngine.process() with allowLockedFinancialYear: true, the one
// sanctioned bypass of "Locked blocks all writes" (see AccountingEngine.js's
// process() docstring and FinancialYear.js's isPostable()). Every adjustment
// is recorded in JournalAuditTrail — an append-only record distinct from the
// generic AuditLog (§5.1) — with a before/after line snapshot.

export class AuditorServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AuditorServiceError";
    this.status = status;
  }
}

export async function getAuditTrail(societyId, { voucherId, financialYearId } = {}) {
  const query = { societyId };
  if (voucherId) query.originalVoucherId = voucherId;
  if (financialYearId) query.financialYearId = financialYearId;
  return JournalAuditTrail.find(query).sort({ adjustedAt: -1 }).lean();
}

/**
 * Posts a correcting adjustment against an already-Posted voucher (which may
 * belong to a Locked Financial Year) and records it in JournalAuditTrail.
 * `lines` are supplied by the auditor — same {accountId, side, amount,
 * narration?} shape as every other linesFromPayload posting rule.
 */
export async function createAdjustment(societyId, { originalVoucherId, lines, reason, date }, actorUserId) {
  if (!reason || !reason.trim()) {
    throw new AuditorServiceError(400, "A reason is required for every Auditor Mode adjustment");
  }
  if (!originalVoucherId) throw new AuditorServiceError(400, "originalVoucherId is required");
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AuditorServiceError(400, "At least two lines are required");
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const originalVoucher = await Voucher.findOne({ _id: originalVoucherId, societyId, isDeleted: false }).session(session);
      if (!originalVoucher) throw new AuditorServiceError(404, "Original voucher not found");
      if (originalVoucher.status !== "Posted" && originalVoucher.status !== "Reversed") {
        throw new AuditorServiceError(409, `Cannot adjust a voucher with status "${originalVoucher.status}" — only a Posted voucher can be corrected`);
      }

      const beforeLines = await JournalLine.find({ voucherId: originalVoucher._id }).session(session).lean();

      const event = createAccountingEvent({
        type: EVENT_TYPES.MANUAL_ADJUSTMENT,
        societyId,
        financialYearId: originalVoucher.financialYearId,
        sourceModule: "Auditor",
        sourceRef: String(originalVoucher._id),
        actorUserId,
        payload: {
          narration: `Auditor adjustment on voucher ${originalVoucher.voucherNumber}: ${reason}`,
          date,
          lines,
        },
      });

      const posted = await engineProcess(event, { session, allowLockedFinancialYear: true });

      const [trail] = await JournalAuditTrail.create(
        [
          {
            societyId,
            financialYearId: originalVoucher.financialYearId,
            action: "Adjustment",
            originalVoucherId: originalVoucher._id,
            originalJournalEntryId: originalVoucher.journalEntryId,
            adjustmentVoucherId: posted.voucher._id,
            adjustmentJournalEntryId: posted.journalEntry?._id || null,
            reason,
            beforeLines,
            afterLines: lines,
            adjustedBy: actorUserId,
          },
        ],
        { session },
      );

      result = { voucher: posted.voucher, journalEntry: posted.journalEntry, auditTrail: trail };
    });
    return result;
  } finally {
    await session.endSession();
  }
}
