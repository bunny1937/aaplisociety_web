import mongoose from "mongoose";
import JournalLine from "@/models/JournalLine";
import Voucher from "@/models/Voucher";
import ChartOfAccount from "@/models/ChartOfAccount";
import FinancialYear from "@/models/FinancialYear";

// Phase 2.9 of the accounting-system revamp (docs/accounting-system-ARD.md
// §7, §8). The General Ledger is DERIVED — there is no GL collection, only
// this read-only aggregation over JournalLine rows. Nothing here writes; the
// ledger can never be "manually edited" because there is nothing to edit.
//
// Convention: running balances are computed debit-positive (a Debit adds, a
// Credit subtracts), then presented as an absolute magnitude plus a Dr/Cr
// label. This is account-type-agnostic and matches how a printed ledger reads.

export class GeneralLedgerServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GeneralLedgerServiceError";
    this.status = status;
  }
}

// Only truly-posted lines count. A Reversed line still counts — its offsetting
// reversal line (also Reversed/Posted) nets it out; Draft/Cancelled never posted.
const BALANCE_STATUSES = ["Posted", "Reversed"];

function oid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

function sideFor(rawSigned) {
  // rawSigned is debit-positive. > 0 → Dr balance, < 0 → Cr balance.
  if (Math.abs(rawSigned) < 0.005) return "";
  return rawSigned > 0 ? "Dr" : "Cr";
}

/**
 * Resolves the effective movement window. If a financial year is given, the
 * window defaults to its date range; explicit dateFrom/dateTo narrow it
 * further. Opening balance is everything strictly before the window start.
 */
async function resolveWindow(societyId, { financialYearId, dateFrom, dateTo }) {
  let fy = null;
  if (financialYearId) {
    fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).lean();
    if (!fy) throw new GeneralLedgerServiceError(404, "Financial Year not found");
  }
  const start = dateFrom ? new Date(dateFrom) : fy ? new Date(fy.startDate) : null;
  const end = dateTo ? new Date(dateTo) : fy ? new Date(fy.endDate) : null;
  return { fy, start, end };
}

async function openingSignedBefore(societyId, accountId, start) {
  if (!start) return 0; // no window start → no prior period → opening 0
  const [agg] = await JournalLine.aggregate([
    {
      $match: {
        societyId: oid(societyId),
        accountId: oid(accountId),
        status: { $in: BALANCE_STATUSES },
        date: { $lt: start },
      },
    },
    {
      $group: {
        _id: null,
        debit: { $sum: { $cond: [{ $eq: ["$side", "Debit"] }, "$amount", 0] } },
        credit: { $sum: { $cond: [{ $eq: ["$side", "Credit"] }, "$amount", 0] } },
      },
    },
  ]);
  if (!agg) return 0;
  return Math.round((agg.debit - agg.credit) * 100) / 100;
}

/**
 * Full ledger for one account: opening balance, every movement line with a
 * running balance, and closing balance. Movement lines are enriched with their
 * voucher number for drill-through.
 */
export async function getAccountLedger(societyId, accountId, opts = {}) {
  const account = await ChartOfAccount.findOne({ _id: accountId, societyId, isDeleted: false }).lean();
  if (!account) throw new GeneralLedgerServiceError(404, "Account not found");

  const { start, end } = await resolveWindow(societyId, opts);

  const openingSigned = await openingSignedBefore(societyId, accountId, start);

  const dateFilter = {};
  if (start) dateFilter.$gte = start;
  if (end) dateFilter.$lte = end;

  const query = {
    societyId: oid(societyId),
    accountId: oid(accountId),
    status: { $in: BALANCE_STATUSES },
  };
  if (start || end) query.date = dateFilter;

  const rawLines = await JournalLine.find(query).sort({ date: 1, createdAt: 1 }).lean();

  // Enrich with voucher numbers in one round-trip.
  const voucherIds = [...new Set(rawLines.map((l) => String(l.voucherId)))];
  const vouchers = await Voucher.find({ _id: { $in: voucherIds } })
    .select("voucherNumber voucherType")
    .lean();
  const voucherById = new Map(vouchers.map((v) => [String(v._id), v]));

  let running = openingSigned;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines = rawLines.map((l) => {
    const signed = l.side === "Debit" ? l.amount : -l.amount;
    running = Math.round((running + signed) * 100) / 100;
    if (l.side === "Debit") totalDebit += l.amount;
    else totalCredit += l.amount;
    const v = voucherById.get(String(l.voucherId));
    return {
      lineId: String(l._id),
      date: l.date,
      voucherId: String(l.voucherId),
      voucherNumber: v?.voucherNumber || null,
      voucherType: v?.voucherType || null,
      journalEntryId: String(l.journalEntryId),
      narration: l.narration || "",
      debit: l.side === "Debit" ? l.amount : 0,
      credit: l.side === "Credit" ? l.amount : 0,
      partyType: l.partyType || null,
      partyRef: l.partyRef ? String(l.partyRef) : null,
      status: l.status,
      runningBalance: Math.abs(running),
      runningSide: sideFor(running),
    };
  });

  const closingSigned = running;
  return {
    account: {
      _id: String(account._id),
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
    },
    openingBalance: Math.abs(openingSigned),
    openingSide: sideFor(openingSigned),
    lines,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    closingBalance: Math.abs(closingSigned),
    closingSide: sideFor(closingSigned),
  };
}

/**
 * Net balance per account across the society (optionally FY-scoped) — a
 * convenience index for GL navigation. This is NOT the authoritative Trial
 * Balance (Phase 2.15 owns the "debit total must equal credit total" gate);
 * it's a read-only per-account summary.
 */
export async function getLedgerSummary(societyId, { financialYearId } = {}) {
  const match = {
    societyId: oid(societyId),
    status: { $in: BALANCE_STATUSES },
  };
  if (financialYearId) match.financialYearId = oid(financialYearId);

  const rows = await JournalLine.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$accountId",
        debit: { $sum: { $cond: [{ $eq: ["$side", "Debit"] }, "$amount", 0] } },
        credit: { $sum: { $cond: [{ $eq: ["$side", "Credit"] }, "$amount", 0] } },
      },
    },
  ]);

  const accountIds = rows.map((r) => r._id);
  const accounts = await ChartOfAccount.find({ _id: { $in: accountIds } })
    .select("code name type normalBalance")
    .lean();
  const accById = new Map(accounts.map((a) => [String(a._id), a]));

  return rows
    .map((r) => {
      const signed = Math.round((r.debit - r.credit) * 100) / 100;
      const acc = accById.get(String(r._id));
      return {
        accountId: String(r._id),
        code: acc?.code || null,
        name: acc?.name || null,
        type: acc?.type || null,
        debit: Math.round(r.debit * 100) / 100,
        credit: Math.round(r.credit * 100) / 100,
        balance: Math.abs(signed),
        side: sideFor(signed),
      };
    })
    .sort((a, b) => (a.code || "").localeCompare(b.code || ""));
}

/** Builds a CSV string from an account ledger (for export). */
export async function exportAccountLedgerCsv(societyId, accountId, opts = {}) {
  const ledger = await getAccountLedger(societyId, accountId, opts);
  // CSV formula-injection guard: a cell beginning with = + - @ or a
  // tab/CR is treated as a formula by Excel/LibreOffice. Narration is
  // free text (manual journal / opening-balance lines), so prefix any such
  // value with a single quote before quoting. Our numeric columns are all
  // non-negative magnitudes, so this never mangles a real number.
  const esc = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [];
  rows.push(
    [`Ledger: ${ledger.account.code} ${ledger.account.name}`].map(esc).join(","),
  );
  rows.push(["Date", "Voucher", "Narration", "Debit", "Credit", "Balance", "Dr/Cr"].map(esc).join(","));
  rows.push(
    ["", "", "Opening Balance", "", "", ledger.openingBalance, ledger.openingSide].map(esc).join(","),
  );
  for (const l of ledger.lines) {
    rows.push(
      [
        new Date(l.date).toISOString().slice(0, 10),
        l.voucherNumber || "",
        l.narration,
        l.debit || "",
        l.credit || "",
        l.runningBalance,
        l.runningSide,
      ]
        .map(esc)
        .join(","),
    );
  }
  rows.push(
    ["", "", "Closing Balance", ledger.totalDebit, ledger.totalCredit, ledger.closingBalance, ledger.closingSide]
      .map(esc)
      .join(","),
  );
  return rows.join("\n");
}
