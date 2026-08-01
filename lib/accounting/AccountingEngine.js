import mongoose from "mongoose";
import FinancialYear from "@/models/FinancialYear";
import ChartOfAccount from "@/models/ChartOfAccount";
import Voucher from "@/models/Voucher";
import {
  createDraftVoucherWithinSession,
  markVoucherPosted,
} from "@/lib/services/VoucherService";
import { assertAccountingEvent } from "@/lib/accounting/events";

// Phase 2.6 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.10). The single entry point for turning a business event into a posted
// Voucher + Journal Entry. NO API route ever generates a Journal Entry
// directly — everything goes through AccountingEngine.process(). This module
// owns the hard part (transaction integrity, §9.2); the two pluggable pieces
// — HOW an event maps to debit/credit accounts, and HOW a JournalEntry
// document is written — are seams that Phase 2.7 (Posting Rule Registry) and
// Phase 2.8 (Journal Engine) register into. Until they do, process() fails
// cleanly with a clear "not registered" error rather than posting nonsense.

const EPSILON = 0.005; // ₹0.005 — same float-precision tolerance the payment code uses.

export class AccountingEngineError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "AccountingEngineError";
    this.status = status;
    this.code = code;
  }
}

// ── Seams (registered by later phases) ───────────────────────────────────────
// Kept on globalThis so registration survives Next.js dev hot-reload, the same
// pattern lib/mongodb.js uses for the connection cache.
const store = (globalThis.__accountingEngine ||= {
  postingResolver: null,
  journalPoster: null,
});

/**
 * Registered by Phase 2.7. Signature:
 *   resolver(event, { session, financialYear }) => Promise<{
 *     voucherType: string,   // one of Voucher.VOUCHER_TYPES
 *     narration?: string,
 *     lines: Array<{
 *       accountId: ObjectId|string,
 *       side: "Debit" | "Credit",
 *       amount: number,           // > 0
 *       partyType?: string,       // §6.16 multi-entity
 *       partyRef?: ObjectId|string,
 *       narration?: string,
 *     }>,
 *   }>
 * The resolver returns fully-resolved account ids (it does the config /
 * BillingHead lookup) — the engine never interprets event types itself.
 */
export function registerPostingResolver(fn) {
  store.postingResolver = fn;
}

/**
 * Registered by Phase 2.8. Signature:
 *   poster({ session, societyId, financialYear, voucher, lines, event })
 *     => Promise<{ _id: ObjectId }>   // the created JournalEntry
 * Responsible only for persisting the JournalEntry + its lines; the engine
 * has already validated that `lines` balance and reference valid accounts.
 */
export function registerJournalPoster(fn) {
  store.journalPoster = fn;
}

// ── Integrity checks (engine-owned, §9.2) ────────────────────────────────────

/** Debit total must equal credit total; every line positive; at least one Dr and one Cr. */
export function assertBalanced(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AccountingEngineError(422, "A journal entry needs at least two lines", "UNBALANCED");
  }
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!(line.amount > 0)) {
      throw new AccountingEngineError(422, "Every journal line amount must be greater than zero", "BAD_LINE");
    }
    if (line.side === "Debit") debit += line.amount;
    else if (line.side === "Credit") credit += line.amount;
    else throw new AccountingEngineError(422, `Journal line side must be "Debit" or "Credit", got "${line.side}"`, "BAD_LINE");
  }
  if (debit === 0 || credit === 0) {
    throw new AccountingEngineError(422, "A journal entry must have at least one debit and one credit line", "UNBALANCED");
  }
  if (Math.abs(debit - credit) > EPSILON) {
    throw new AccountingEngineError(
      422,
      `Journal entry does not balance: debit ${debit.toFixed(2)} vs credit ${credit.toFixed(2)}`,
      "UNBALANCED",
    );
  }
}

/** Every referenced account must exist, belong to this society, and be active. */
export async function assertAccountsValid(societyId, lines, session) {
  const ids = [...new Set(lines.map((l) => String(l.accountId)))];
  const accounts = await ChartOfAccount.find({
    _id: { $in: ids },
    societyId,
    isDeleted: false,
  })
    .session(session)
    .lean();
  const byId = new Map(accounts.map((a) => [String(a._id), a]));
  for (const id of ids) {
    const acc = byId.get(id);
    if (!acc) {
      throw new AccountingEngineError(422, `Account ${id} does not exist in this society's Chart of Accounts`, "UNMAPPED_ACCOUNT");
    }
    if (!acc.isActive) {
      throw new AccountingEngineError(422, `Account "${acc.name}" (${acc.code}) is inactive and cannot be posted to`, "INACTIVE_ACCOUNT");
    }
  }
}

// ── The entry point ──────────────────────────────────────────────────────────

/**
 * Processes an AccountingEvent into a posted Voucher + Journal Entry.
 *
 * Runs inside a MongoDB transaction. If `session` is supplied (the caller —
 * e.g. PaymentService — already has a transaction open), the whole posting
 * joins that transaction so the triggering write and this posting commit or
 * roll back together (§6.10). If no session is supplied, the engine opens
 * and owns its own.
 *
 * `allowLockedFinancialYear` is the ONE sanctioned bypass of "Locked blocks
 * all writes" (see FinancialYear.js's isPostable() docstring) — reserved for
 * Auditor Mode (Phase 2.19), which must be able to post adjustment entries
 * against an already-Locked period under mandatory-remarks control. No other
 * caller should ever pass this true; AuditorService is the only one that does.
 *
 * @returns {Promise<{ voucher, journalEntry, idempotentHit?: boolean }>}
 */
export async function process(event, { session: externalSession, allowLockedFinancialYear = false } = {}) {
  assertAccountingEvent(event);
  if (!store.postingResolver) {
    throw new AccountingEngineError(
      500,
      "No posting resolver registered — Phase 2.7 (Posting Rule Registry) must register one before events can be processed",
      "NO_RESOLVER",
    );
  }
  if (!store.journalPoster) {
    throw new AccountingEngineError(
      500,
      "No journal poster registered — Phase 2.8 (Journal Engine) must register one before events can be processed",
      "NO_POSTER",
    );
  }

  const runner = (session) => processWithinSession(event, session, allowLockedFinancialYear);

  if (externalSession) {
    return runner(externalSession);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await runner(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function processWithinSession(event, session, allowLockedFinancialYear = false) {
  const { societyId, financialYearId, idempotencyKey } = event;

  // 1. Idempotency (§9.2) — if this event already produced a live voucher, return it.
  if (idempotencyKey) {
    const existing = await Voucher.findOne({
      societyId,
      idempotencyKey,
      status: { $in: ["Posted", "Reversed"] },
      isDeleted: false,
    }).session(session);
    if (existing) {
      return { voucher: existing, journalEntry: null, idempotentHit: true };
    }
  }

  // 2. Financial Year must exist and be postable (§6.6).
  const financialYear = await FinancialYear.findOne({
    _id: financialYearId,
    societyId,
    isDeleted: false,
  }).session(session);
  if (!financialYear) {
    throw new AccountingEngineError(404, "Financial Year not found for this event", "NO_FY");
  }
  if (!financialYear.isPostable() && !allowLockedFinancialYear) {
    throw new AccountingEngineError(
      409,
      `Financial Year "${financialYear.label}" is Locked — event cannot be posted`,
      "FY_LOCKED",
    );
  }

  // 3. Resolve the posting rule → voucher type + fully-resolved debit/credit lines (Phase 2.7 seam).
  const resolved = await store.postingResolver(event, { session, financialYear });
  if (!resolved || !resolved.voucherType || !Array.isArray(resolved.lines)) {
    throw new AccountingEngineError(
      422,
      `Posting resolver returned nothing usable for event type "${event.type}"`,
      "NO_RULE",
    );
  }

  // 4. Accounting-level integrity (engine-owned, §9.2).
  assertBalanced(resolved.lines);
  await assertAccountsValid(societyId, resolved.lines, session);

  // 5. Create the Draft voucher inside this same transaction.
  const voucher = await createDraftVoucherWithinSession(session, {
    societyId,
    financialYearId: financialYear._id,
    voucherType: resolved.voucherType,
    date: event.payload?.date,
    narration: resolved.narration || event.payload?.narration,
    sourceModule: event.sourceModule,
    sourceRef: event.sourceRef,
    idempotencyKey,
    createdBy: event.actorUserId,
    financialYear,
    allowLockedFinancialYear,
  });

  // 6. Persist the JournalEntry + lines (Phase 2.8 seam).
  const journalEntry = await store.journalPoster({
    session,
    societyId,
    financialYear,
    voucher,
    lines: resolved.lines,
    event,
  });

  // 7. Flip the voucher Draft → Posted, linking its journal entry. Use the
  // doc markVoucherPosted returns (not the original `voucher` in-memory
  // object above) — that one is still the stale Draft-status copy from step
  // 5; every caller that reads result.voucher.status right after process()
  // resolves needs to see "Posted", not "Draft". Found by
  // accounting-smoke.unit.test.js.
  const postedVoucher = await markVoucherPosted(voucher._id, journalEntry._id, session);

  return { voucher: postedVoucher, journalEntry };
}

// Default singleton-style export for ergonomic imports.
export const AccountingEngine = {
  process,
  registerPostingResolver,
  registerJournalPoster,
  assertBalanced,
  assertAccountsValid,
};
