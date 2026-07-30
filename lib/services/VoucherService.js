import mongoose from "mongoose";
import Voucher from "@/models/Voucher";
import FinancialYear from "@/models/FinancialYear";
import DocumentSequence from "@/models/DocumentSequence";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";

export class VoucherServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "VoucherServiceError";
    this.status = status;
  }
}

/**
 * Atomically allocates the next voucher number for
 * {societyId, financialYearId, voucherType} — a single findOneAndUpdate
 * with $inc, never read-then-write (§6.2, §9.2/§10.2). Format:
 * "{prefix}-{FYstartYear}-{paddedNumber}", e.g. "JV-2025-00001". Prefix and
 * padding come from Society.accountingConfig via FiscalConfigService, which
 * always returns a defaulted config even for societies that haven't set one.
 */
export async function allocateVoucherNumber(
  societyId,
  financialYear,
  voucherType,
  session,
) {
  if (!Voucher.VOUCHER_TYPES.includes(voucherType)) {
    throw new VoucherServiceError(400, `Invalid voucherType: ${voucherType}`);
  }
  const seq = await DocumentSequence.findOneAndUpdate(
    { societyId, financialYearId: financialYear._id, voucherType },
    { $inc: { lastNumber: 1 } },
    { upsert: true, new: true, session },
  );
  const config = await getFiscalConfig(societyId, session);
  const prefix = config.voucherPrefixes[voucherType] || voucherType.slice(0, 2).toUpperCase();
  const padding = config.voucherNumberPadding || 5;
  const fyStartYear = financialYear.startDate.getFullYear();
  const padded = String(seq.lastNumber).padStart(padding, "0");
  return `${prefix}-${fyStartYear}-${padded}`;
}

/**
 * Session-aware core of draft-voucher creation. Runs inside a caller-owned
 * transaction — the Accounting Engine (Phase 2.6) calls this so the voucher,
 * its journal entry, and the triggering write all commit or roll back
 * together (§6.10). Optionally accepts a pre-loaded `financialYear` document
 * to avoid re-querying it when the caller already has it in hand.
 */
export async function createDraftVoucherWithinSession(
  session,
  {
    societyId,
    financialYearId,
    voucherType,
    date,
    narration,
    sourceModule,
    sourceRef,
    idempotencyKey,
    createdBy,
    financialYear: preloadedFY,
  },
) {
  if (!Voucher.SOURCE_MODULES.includes(sourceModule)) {
    throw new VoucherServiceError(400, `Invalid sourceModule: ${sourceModule}`);
  }
  const financialYear =
    preloadedFY ||
    (await FinancialYear.findOne({
      _id: financialYearId,
      societyId,
      isDeleted: false,
    }).session(session));
  if (!financialYear) {
    throw new VoucherServiceError(404, "Financial Year not found");
  }
  if (!financialYear.isPostable()) {
    throw new VoucherServiceError(
      409,
      `Financial Year "${financialYear.label}" is Locked — no new vouchers can be created against it`,
    );
  }
  const voucherNumber = await allocateVoucherNumber(
    societyId,
    financialYear,
    voucherType,
    session,
  );
  const [created] = await Voucher.create(
    [
      {
        societyId,
        financialYearId: financialYear._id,
        voucherType,
        voucherNumber,
        date: date ? new Date(date) : new Date(),
        narration,
        sourceModule,
        sourceRef: sourceRef || null,
        idempotencyKey: idempotencyKey || null,
        createdBy,
      },
    ],
    { session },
  );
  return created;
}

/**
 * Creates a Draft voucher — allocates its number and inserts the header
 * atomically. Public, API-facing wrapper that owns its own transaction. On
 * its own, a Draft voucher has no journalEntryId yet (see models/Voucher.js);
 * the Accounting/Journal Engine attaches that when it posts.
 */
export async function createDraftVoucher(params) {
  const session = await mongoose.startSession();
  try {
    let voucher;
    await session.withTransaction(async () => {
      voucher = await createDraftVoucherWithinSession(session, params);
    });
    return voucher;
  } finally {
    await session.endSession();
  }
}

export async function listVouchers(societyId, { financialYearId, status, voucherType, sourceModule } = {}) {
  const query = { societyId, isDeleted: false };
  if (financialYearId) query.financialYearId = financialYearId;
  if (status) query.status = status;
  if (voucherType) query.voucherType = voucherType;
  if (sourceModule) query.sourceModule = sourceModule;
  return Voucher.find(query).sort({ createdAt: -1 }).lean();
}

export async function getVoucherById(societyId, id) {
  const voucher = await Voucher.findOne({ _id: id, societyId, isDeleted: false });
  if (!voucher) throw new VoucherServiceError(404, "Voucher not found");
  return voucher;
}

export async function submitForApproval(societyId, id) {
  const voucher = await getVoucherById(societyId, id);
  if (voucher.status !== "Draft") {
    throw new VoucherServiceError(409, `Only Draft vouchers can be submitted for approval (current status: ${voucher.status})`);
  }
  voucher.approvalStatus = "Pending";
  await voucher.save();
  return voucher;
}

export async function approveVoucher(societyId, id, { actorUserId }) {
  const voucher = await getVoucherById(societyId, id);
  if (voucher.approvalStatus !== "Pending") {
    throw new VoucherServiceError(409, `Voucher is not pending approval (approvalStatus: ${voucher.approvalStatus})`);
  }
  voucher.approvalStatus = "Approved";
  voucher.approvedBy = actorUserId;
  voucher.approvedAt = new Date();
  await voucher.save();
  return voucher;
}

export async function rejectVoucher(societyId, id, { actorUserId, reason }) {
  if (!reason || !reason.trim()) {
    throw new VoucherServiceError(400, "A reason is required to reject a voucher");
  }
  const voucher = await getVoucherById(societyId, id);
  if (voucher.approvalStatus !== "Pending") {
    throw new VoucherServiceError(409, `Voucher is not pending approval (approvalStatus: ${voucher.approvalStatus})`);
  }
  voucher.approvalStatus = "Rejected";
  voucher.rejectedBy = actorUserId;
  voucher.rejectedAt = new Date();
  voucher.rejectionReason = reason;
  await voucher.save();
  return voucher;
}

/** Draft-only — a voucher that already has a posted Journal Entry cannot be cancelled, only reversed (see reverseVoucher, wired up once Phase 2.8 exists). */
export async function cancelVoucher(societyId, id, { actorUserId, reason }) {
  if (!reason || !reason.trim()) {
    throw new VoucherServiceError(400, "A reason is required to cancel a voucher");
  }
  const voucher = await getVoucherById(societyId, id);
  if (voucher.status !== "Draft") {
    throw new VoucherServiceError(409, `Only Draft vouchers can be cancelled (current status: ${voucher.status}) — a Posted voucher must be reversed instead`);
  }
  voucher.status = "Cancelled";
  voucher.cancelledBy = actorUserId;
  voucher.cancelledAt = new Date();
  voucher.cancellationReason = reason;
  await voucher.save();
  return voucher;
}

/**
 * Internal primitive — NOT exposed as a direct API action. Called by the
 * Journal Engine (Phase 2.8) once it has built and validated a balanced set
 * of Journal lines for this voucher. Requires approvalStatus to already be
 * Approved or NotRequired, so an approval-gated voucher can't be posted
 * around the approval workflow.
 */
export async function markVoucherPosted(voucherId, journalEntryId, session) {
  const voucher = await Voucher.findById(voucherId).session(session);
  if (!voucher) throw new VoucherServiceError(404, "Voucher not found");
  if (voucher.status !== "Draft") {
    throw new VoucherServiceError(409, `Cannot post a voucher with status "${voucher.status}"`);
  }
  if (voucher.approvalStatus === "Pending") {
    throw new VoucherServiceError(409, "Voucher is pending approval and cannot be posted yet");
  }
  if (voucher.approvalStatus === "Rejected") {
    throw new VoucherServiceError(409, "Voucher was rejected and cannot be posted");
  }
  voucher.status = "Posted";
  voucher.journalEntryId = journalEntryId;
  await voucher.save({ session });
  return voucher;
}

/**
 * Internal primitive — links a Posted voucher to its offsetting reversal
 * voucher. Called by the Journal Engine once it has created the offsetting
 * Journal Entry + Voucher pair (§6.7: reversal creates a new voucher, never
 * mutates the original).
 */
export async function markVoucherReversed(voucherId, reversalVoucherId, session) {
  const voucher = await Voucher.findById(voucherId).session(session);
  if (!voucher) throw new VoucherServiceError(404, "Voucher not found");
  if (voucher.status !== "Posted") {
    throw new VoucherServiceError(409, `Only a Posted voucher can be reversed (current status: ${voucher.status})`);
  }
  voucher.status = "Reversed";
  voucher.reversedByVoucherId = reversalVoucherId;
  await voucher.save({ session });
  return voucher;
}
