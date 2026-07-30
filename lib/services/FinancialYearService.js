import FinancialYear from "@/models/FinancialYear";
import { getFinancialYear, getFinancialYearRange } from "@/lib/date-utils";

export class FinancialYearServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FinancialYearServiceError";
    this.status = status;
  }
}

const { STATES, FORWARD_TRANSITIONS } = FinancialYear;

/**
 * Creates a new Financial Year for a society. Defaults label/startDate/endDate
 * from lib/date-utils.js's existing getFinancialYear()/getFinancialYearRange()
 * so the label matches the "FY2025-26" format already written into
 * Transaction.financialYear elsewhere in the codebase — this is a deliberate
 * consistency choice, not the "2025-2026" example format sketched in the ARD.
 */
export async function createFinancialYear({
  societyId,
  label,
  startDate,
  endDate,
  createdBy,
}) {
  let resolvedLabel = label;
  let resolvedStart = startDate ? new Date(startDate) : null;
  let resolvedEnd = endDate ? new Date(endDate) : null;

  if (!resolvedStart || !resolvedEnd) {
    const range = getFinancialYearRange(resolvedLabel || getFinancialYear());
    resolvedStart = resolvedStart || range.startDate;
    resolvedEnd = resolvedEnd || range.endDate;
  }
  if (!resolvedLabel) {
    resolvedLabel = getFinancialYear(resolvedStart);
  }
  if (resolvedEnd <= resolvedStart) {
    throw new FinancialYearServiceError(400, "endDate must be after startDate");
  }

  // Overlap check — Mongo can't express range-overlap in a unique index, so
  // this has to happen in the service. Two ranges overlap iff
  // existing.start < new.end AND existing.end > new.start.
  const overlapping = await FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lt: resolvedEnd },
    endDate: { $gt: resolvedStart },
  }).lean();
  if (overlapping) {
    throw new FinancialYearServiceError(
      409,
      `Financial Year "${overlapping.label}" already covers an overlapping date range`,
    );
  }

  const fy = await FinancialYear.create({
    societyId,
    label: resolvedLabel,
    startDate: resolvedStart,
    endDate: resolvedEnd,
    createdBy,
  });
  return fy;
}

export async function listFinancialYears(societyId) {
  return FinancialYear.find({ societyId, isDeleted: false })
    .sort({ startDate: -1 })
    .lean();
}

export async function getFinancialYearById(societyId, id) {
  const fy = await FinancialYear.findOne({ _id: id, societyId, isDeleted: false });
  if (!fy) throw new FinancialYearServiceError(404, "Financial Year not found");
  return fy;
}

/** Resolves the Financial Year whose date range contains `date` (defaults to now). */
export async function getCurrentFinancialYear(societyId, date = new Date()) {
  return FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lte: date },
    endDate: { $gte: date },
  });
}

/**
 * Advances a Financial Year exactly one step along the forward-only
 * Draft -> Reviewed -> Auditor Review -> Approved -> Locked chain (§6.6).
 * Skipping states is not allowed — call this once per transition, not with
 * an arbitrary target state, so every intermediate state is actually
 * recorded in the transition log.
 */
export async function transitionFinancialYear({
  societyId,
  id,
  byUserId,
  byRole,
  note,
}) {
  const fy = await getFinancialYearById(societyId, id);
  const next = FORWARD_TRANSITIONS[fy.status];
  if (!next) {
    throw new FinancialYearServiceError(
      409,
      `Financial Year is already "${fy.status}" — no further forward transition exists. Use the reopen path if this needs to go backward.`,
    );
  }
  if (next === "Locked" && !fy.openingBalancesConfirmed) {
    throw new FinancialYearServiceError(
      409,
      "Cannot lock a Financial Year until opening balances are confirmed (see Opening Balance Wizard, Phase 2.10)",
    );
  }
  fy.transitions.push({
    fromStatus: fy.status,
    toStatus: next,
    byUserId,
    byRole,
    note,
  });
  fy.status = next;
  await fy.save();
  return fy;
}

/**
 * SuperAdmin-only exception path — reopens a Locked (or any) Financial Year
 * back to Draft. Matches the original spec's "Year reopening" exception
 * item. Callers (the API route) are responsible for enforcing the SuperAdmin
 * check before calling this; the service records the reopen but does not
 * itself re-check the role, since it has no access to the SuperAdmin auth
 * context (a separate JWT/cookie domain — see docs/accounting-system-ARD.md
 * §2.3 on the three parallel auth stacks).
 */
export async function reopenFinancialYear({ societyId, id, byUserId, byRole, note }) {
  if (!note || !note.trim()) {
    throw new FinancialYearServiceError(400, "A reason is required to reopen a Financial Year");
  }
  const fy = await getFinancialYearById(societyId, id);
  fy.transitions.push({
    fromStatus: fy.status,
    toStatus: "Draft",
    byUserId,
    byRole,
    note,
    isReopen: true,
  });
  fy.status = "Draft";
  await fy.save();
  return fy;
}

export { STATES, FORWARD_TRANSITIONS };
