import mongoose from "mongoose";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import AuditEvent from "@/models/AuditEvent";
import { calculateMonthlyInterest } from "@/utils/interestUtils";
import { calculateMemberCharges } from "@/lib/calculate-member-bill";
import { safeConfigDate } from "@/utils/dateUtils";
import { validateBillInvariants, validateCarryForward } from "@/lib/billing/invariants";

export const ENGINE_VERSION = "Ledger V2";
export const CALCULATION_VERSION = 1;
export const SCHEMA_VERSION = 2;

const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));
const prevPeriodId = (year, month) =>
  month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;

/**
 * Pure computation — no DB writes. Given the inputs, returns the full canonical
 * bill payload. Deterministic (§10): never reads Date.now() for a monetary value.
 */
export function computeBill({ member, heads, society, year, month, openingPrincipal, openingInterest }) {
  const { breakdown, subtotal } = calculateMemberCharges(member, heads);
  const interestRate = society?.config?.interestRate || 0;
  const interestRounding = society?.config?.interestRounding || "TWO_DECIMAL";

  const _openingPrincipal = twoDp(openingPrincipal);
  const _openingInterest = twoDp(openingInterest);

  let currentInterest = 0;
  if (_openingPrincipal > 0) {
    const { currInt } = calculateMonthlyInterest({
      remainingPrincipal: _openingPrincipal,
      remInt: 0,
      annualRate: interestRate,
      interestRounding,
    });
    currentInterest = twoDp(currInt);
  }

  const currentCharges = twoDp(subtotal);
  const billPrincipalBalance = twoDp(_openingPrincipal + currentCharges);
  const billInterestBalance = twoDp(_openingInterest + currentInterest);
  const totalBillDue = twoDp(billPrincipalBalance + billInterestBalance);
  // No-payment-yet default (§1/§3): closing = opening + current.
  const closingPrincipal = billPrincipalBalance;
  const closingInterest = billInterestBalance;
  const balanceAmount = twoDp(closingPrincipal + closingInterest);

  const charges = Object.fromEntries(
    Object.entries(breakdown || {}).map(([k, v]) => [k, twoDp(v)]),
  );

  return {
    openingPrincipal: _openingPrincipal,
    openingInterest: _openingInterest,
    currentCharges,
    currentInterest,
    interestRateApplied: interestRate,
    billPrincipalBalance,
    billInterestBalance,
    totalBillDue,
    closingPrincipal,
    closingInterest,
    balanceAmount,
    charges,
  };
}

export async function resolveOpeningBalances({ memberId, societyId, year, month, member }, sessionOpts = {}) {
  const periodId = `${year}-${String(month).padStart(2, "0")}`;
  // Most-recent PRIOR bill, not just the exact previous period. A missing or
  // mis-keyed month must never silently reset the ledger to the member seed —
  // that was the "August opening = July's seed (1000/200)" carry-forward drop.
  // Zero-padded "YYYY-MM" ids sort lexicographically, so $lt + sort desc works.
  const prevBill = await Bill.findOne({
    memberId,
    societyId,
    isDeleted: { $ne: true },
    billPeriodId: { $lt: periodId },
  })
    .sort({ billPeriodId: -1 })
    .select("billPeriodId closingPrincipal closingInterest billPrincipalBalance billInterestBalance principalBalance interestBalance openingPrincipal openingInterest currentCharges currentInterest")
    .setOptions(sessionOpts)
    .lean();

  if (prevBill) {
    // Closing = unpaid balance carried forward. Prefer canonical V2 closing
    // fields; reconstruct for older/imported bills that never stored them
    // (opening + current), so the carry-forward is never lost to a null field.
    const p =
      prevBill.closingPrincipal ??
      prevBill.billPrincipalBalance ??
      prevBill.principalBalance ??
      twoDp((prevBill.openingPrincipal || 0) + (prevBill.currentCharges || 0));
    const i =
      prevBill.closingInterest ??
      prevBill.billInterestBalance ??
      prevBill.interestBalance ??
      twoDp((prevBill.openingInterest || 0) + (prevBill.currentInterest || 0));
    return { prevBill, openingPrincipal: twoDp(p), openingInterest: twoDp(i) };
  }
  // First-ever bill — seed from member opening balances.
  return {
    prevBill: null,
    openingPrincipal: twoDp(member.openingPrincipal || 0),
    openingInterest: twoDp(member.openingInterest || 0),
  };
}

// Shared: duplicate guard + load member/society/heads. Throws P4_DUPLICATE / MEMBER_NOT_FOUND.
async function loadGenerationContext({ societyId, memberId, year, month }) {
  const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
  const existing = await Bill.findOne({ societyId, memberId, billPeriodId, isDeleted: { $ne: true } }).lean();
  if (existing) {
    const err = new Error(`Bill already exists for ${billPeriodId}`);
    err.code = "P4_DUPLICATE";
    throw err;
  }
  const [member, society, heads] = await Promise.all([
    Member.findById(memberId)
      .select("flatNo wing ownerName carpetAreaSqft openingPrincipal openingInterest openingBalance advanceCredit")
      .lean(),
    Society.findById(societyId).lean(),
    BillingHead.find({ societyId, isActive: true, isDeleted: false }).sort({ order: 1 }).lean(),
  ]);
  if (!member) {
    const err = new Error("Member not found");
    err.code = "MEMBER_NOT_FOUND";
    throw err;
  }
  return { billPeriodId, member, society, heads };
}

// Shared: compute + validate + atomic Bill+AuditEvent write.
async function persistBill({
  societyId, memberId, year, month, performedBy,
  billPeriodId, member, society, heads, openingPrincipal, openingInterest,
  publishMode = "config", scheduledFor = null,
}) {
  const computed = computeBill({ member, heads, society, year, month, openingPrincipal, openingInterest });
  validateBillInvariants(computed);

const now = new Date();
const configuredDue = safeConfigDate(year, month, society?.config?.billDueDay || 10);
// A bill must never be born overdue. When it's generated on/after its
// configured due day (late run, mid-month onboarding, back-dated period),
// fall back to a grace window measured from the generation date.
const graceDays =
  society?.config?.interestAfterDays ?? society?.config?.gracePeriodDays ?? 15;
const dueDate =
  configuredDue >= now
    ? configuredDue
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + graceDays, 0, 0, 0, 0);
const configuredPushDate = safeConfigDate(year, month, society?.config?.billPushDay || 1);
const requestedPushDate = scheduledFor ? new Date(scheduledFor) : null;
const validRequestedPushDate =
  requestedPushDate && !Number.isNaN(requestedPushDate.getTime())
    ? requestedPushDate
    : null;
const pushDate = publishMode === "schedule" && validRequestedPushDate
  ? validRequestedPushDate
  : configuredPushDate;
const isScheduled = publishMode === "now" ? false : publishMode === "schedule" ? true : now < pushDate;
  const billDoc = {
    billPeriodId,
    billMonth: month - 1,
    billYear: year,
    memberId,
    societyId,
    // canonical
    openingPrincipal: computed.openingPrincipal,
    openingInterest: computed.openingInterest,
    currentCharges: computed.currentCharges,
    currentInterest: computed.currentInterest,
    interestRateApplied: computed.interestRateApplied,
    billPrincipalBalance: computed.billPrincipalBalance,
    billInterestBalance: computed.billInterestBalance,
    totalBillDue: computed.totalBillDue,
    closingPrincipal: computed.closingPrincipal,
    closingInterest: computed.closingInterest,
    closingTotal: computed.balanceAmount,
    charges: new Map(Object.entries(computed.charges)),
    amountPaid: 0,
    balanceAmount: computed.balanceAmount,
    dueDate,
    status: isScheduled ? "Scheduled" : "Unpaid",
    scheduledPushDate: isScheduled ? pushDate : null,
    generatedBy: performedBy && performedBy !== "System" && performedBy !== "Cron" ? performedBy : undefined,
    generatedAt: new Date(),
    importedFrom: "System",
    schemaVersion: SCHEMA_VERSION,
    calculationVersion: CALCULATION_VERSION,
    rendererVersion: 1,
    engineVersion: ENGINE_VERSION,
    isDeleted: false,
    // ── legacy dual-write (§15 migration window; dropped after cutover) ──
    previousBalance: twoDp(computed.openingPrincipal + computed.openingInterest),
    previousPrincipal: computed.openingPrincipal,
    previousInterest: computed.openingInterest,
    currInt: computed.currentInterest,
    monthInterest: twoDp(computed.openingInterest + computed.currentInterest),
    interestAmount: twoDp(computed.openingInterest + computed.currentInterest),
    principalBalance: computed.billPrincipalBalance,
    interestBalance: computed.billInterestBalance,
    subtotal: computed.currentCharges,
    currentBillTotal: computed.totalBillDue,
    totalAmount: computed.totalBillDue,
  };

  const auditDoc = {
    societyId,
    memberId,
    eventType: "BILL_GENERATED",
    timestamp: new Date(),
    performedBy: performedBy || "System",
    calculationVersion: CALCULATION_VERSION,
    engineVersion: ENGINE_VERSION,
    openingPrincipal: computed.openingPrincipal,
    openingInterest: computed.openingInterest,
    currentCharges: computed.currentCharges,
    currentInterest: computed.currentInterest,
    totalBillDue: computed.totalBillDue,
    interestRateApplied: computed.interestRateApplied,
  };

  // Atomic write: bill + audit in one transaction where supported (Atlas
  // replica set). Falls back to compensating delete on standalone Mongo.
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const [bill] = await Bill.create([billDoc], { session });
      await AuditEvent.create([{ ...auditDoc, billId: bill._id }], { session });
      created = bill;
    });
    return created;
  } catch (txErr) {
    if (/Transaction numbers|replica set|not supported/i.test(txErr.message || "")) {
      const bill = await Bill.create(billDoc);
      try {
        await AuditEvent.create({ ...auditDoc, billId: bill._id });
      } catch (auditErr) {
        await Bill.deleteOne({ _id: bill._id }); // compensate — never a bill without its audit
        throw auditErr;
      }
      return bill;
    }
    throw txErr;
  } finally {
    session.endSession();
  }
}

/**
 * PRODUCTION generation. Opening balances ALWAYS derive from the previous
 * bill's closing balances (§5). There is deliberately NO opening-override
 * parameter here — the live flow can never inject seeded balances.
 * Idempotent per P4: an existing bill for (society, member, period) is
 * rejected, never overwritten.
 */
export async function generateBill({
  societyId, memberId, year, month, performedBy,
  publishMode = "config", scheduledFor = null,
}) {
  const ctx = await loadGenerationContext({ societyId, memberId, year, month });
  const { prevBill, openingPrincipal, openingInterest } = await resolveOpeningBalances({
    memberId, societyId, year, month, member: ctx.member,
  });
  validateCarryForward(prevBill, openingPrincipal, openingInterest, ctx.billPeriodId);
  return persistBill({
    societyId, memberId, year, month, performedBy, ...ctx,
    openingPrincipal, openingInterest, publishMode, scheduledFor,
  });
}

/**
 * SIMULATOR-ONLY generation. Accepts explicit seeded opening balances so the
 * billing simulator can model arbitrary scenarios. MUST NOT be used by the
 * production billing flow. Carry-forward validation is intentionally skipped
 * because a simulation has no real predecessor bill to validate against.
 */
export async function generateSimulatedBill({
  societyId, memberId, year, month, performedBy, openingPrincipal, openingInterest,
}) {
  const ctx = await loadGenerationContext({ societyId, memberId, year, month });
  let op, oi;
  if (openingPrincipal != null || openingInterest != null) {
    op = twoDp(openingPrincipal || 0);
    oi = twoDp(openingInterest || 0);
  } else {
    const resolved = await resolveOpeningBalances({ memberId, societyId, year, month, member: ctx.member });
    op = resolved.openingPrincipal;
    oi = resolved.openingInterest;
  }
  return persistBill({ societyId, memberId, year, month, performedBy, ...ctx, openingPrincipal: op, openingInterest: oi });
}

/** Batch: N independent single-doc writes (§7). Failures reported per-member. */
export async function generateBillsForMembers({ societyId, memberIds, year, month, performedBy }) {
  const results = { generated: [], failed: [] };
  for (const memberId of memberIds) {
    try {
      const bill = await generateBill({ societyId, memberId, year, month, performedBy });
      results.generated.push({ memberId, billId: bill._id });
    } catch (err) {
      results.failed.push({ memberId, code: err.code || "ERROR", reason: err.message });
    }
  }
  return results;
}