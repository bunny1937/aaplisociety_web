import JournalEntry from "@/models/JournalEntry";
import JournalLine from "@/models/JournalLine";

// Phase 2.8 — persists a JournalEntry header + its JournalLine rows inside a
// caller-owned transaction. `postJournal` is the seam the Accounting Engine
// calls (registered in bootstrap.js); `persistJournalEntry` is the shared
// primitive both the seam and the reversal path use. Neither validates that
// lines balance — the Accounting Engine already did that (§9.2) before
// calling; the reversal path builds lines by flipping an already-balanced
// entry, so balance is preserved by construction.

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Creates a JournalEntry + its lines. Returns the entry.
 * @param {object} p
 * @param {object} p.session          active mongoose session (required)
 * @param {object} p.societyId
 * @param {object} p.financialYear    loaded FinancialYear doc
 * @param {object} p.voucher          the owning Voucher doc
 * @param {Array}  p.lines            [{ accountId, side, amount, partyType?, partyRef?, narration? }]
 * @param {string} p.sourceModule
 * @param {ObjectId|null} p.sourceRef
 * @param {string} [p.status]         defaults "Posted"
 * @param {ObjectId|null} [p.reversalOfJournalEntryId]
 * @param {ObjectId|null} [p.createdBy]
 */
export async function persistJournalEntry({
  session,
  societyId,
  financialYear,
  voucher,
  lines,
  sourceModule,
  sourceRef = null,
  status = "Posted",
  reversalOfJournalEntryId = null,
  createdBy = null,
}) {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    if (line.side === "Debit") totalDebit += line.amount;
    else totalCredit += line.amount;
  }
  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);

  const [entry] = await JournalEntry.create(
    [
      {
        societyId,
        financialYearId: financialYear._id,
        voucherId: voucher._id,
        date: voucher.date,
        narration: voucher.narration,
        totalDebit,
        totalCredit,
        lineCount: lines.length,
        status,
        sourceModule,
        sourceRef,
        reversalOfJournalEntryId,
        createdBy,
      },
    ],
    { session },
  );

  const lineDocs = lines.map((l) => ({
    societyId,
    financialYearId: financialYear._id,
    journalEntryId: entry._id,
    voucherId: voucher._id,
    accountId: l.accountId,
    side: l.side,
    amount: round2(l.amount),
    partyType: l.partyType || null,
    partyRef: l.partyRef || null,
    narration: l.narration,
    date: voucher.date,
    status,
  }));
  await JournalLine.create(lineDocs, { session });

  return entry;
}

/**
 * The journal-poster seam registered into AccountingEngine (Phase 2.8).
 * Signature per lib/accounting/AccountingEngine.js registerJournalPoster().
 */
export async function postJournal({ session, societyId, financialYear, voucher, lines, event }) {
  return persistJournalEntry({
    session,
    societyId,
    financialYear,
    voucher,
    lines,
    sourceModule: event.sourceModule,
    sourceRef: event.sourceRef,
    status: "Posted",
    createdBy: event.actorUserId,
  });
}
