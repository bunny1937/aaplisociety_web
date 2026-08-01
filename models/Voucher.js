import mongoose from "mongoose";

// Phase 2.5 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.1, §6.7, §6.8). The auditor-facing document; the Journal Entry
// underneath it (Phase 2.8) carries the actual debit/credit lines. Every
// Journal Entry belongs to exactly one Voucher (1:1) — journalEntryId here
// is nullable because this phase builds the Voucher lifecycle before the
// Journal Engine exists to populate it; a Draft voucher legitimately has no
// journalEntryId yet.
const VOUCHER_TYPES = ["Receipt", "Payment", "Journal", "Contra", "DebitNote", "CreditNote"];
const STATUSES = ["Draft", "Posted", "Reversed", "Cancelled"];
const APPROVAL_STATUSES = ["NotRequired", "Pending", "Approved", "Rejected"];
const SOURCE_MODULES = [
  "Billing",
  "Payments",
  "Assets",
  "Liabilities",
  "Funds",
  "Interest",
  "Manual",
  "Auditor",
  "Migration",
  "OpeningBalance",
  "Import",
];

const VoucherSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    financialYearId: { type: mongoose.Schema.Types.ObjectId, ref: "FinancialYear", required: true, index: true },
    voucherType: { type: String, enum: VOUCHER_TYPES, required: true },
    voucherNumber: { type: String, required: true },
    date: { type: Date, required: true },
    narration: { type: String, trim: true },
    status: { type: String, enum: STATUSES, default: "Draft", index: true },
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: "NotRequired" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true },
    // Traceability back to the billing-side event that triggered this
    // voucher (§6.8). sourceRef intentionally has no `ref` — it can point
    // at Bill, Transaction, Asset, etc. depending on sourceModule.
    sourceModule: { type: String, enum: SOURCE_MODULES, required: true },
    sourceRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Optional idempotency guard (§9.2 "no duplicate posting"). When the
    // Accounting Engine is handed an AccountingEvent carrying an
    // idempotencyKey, it stores it here and refuses to post a second voucher
    // with the same key. Enforced both in application logic AND by the
    // partial unique index below (defense in depth). Null for events that
    // legitimately repeat (e.g. manual adjustments).
    idempotencyKey: { type: String, default: null, trim: true },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "JournalEntry", default: null },
    // Reversal always creates a NEW offsetting voucher rather than mutating
    // the original (§6.7) — bidirectional link between the two.
    reversalOfVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", default: null },
    reversedByVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: "Voucher", default: null },
    // Not required: cron/system-triggered postings (e.g. BillGenerated from a
    // scheduled bill run) have no human actor. JournalEntry.createdBy is
    // already optional for the same reason — Voucher was the one place that
    // hadn't caught up, which broke the first system-triggered posting this
    // was tried against.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

VoucherSchema.index({ societyId: 1, voucherNumber: 1 }, { unique: true });
VoucherSchema.index({ societyId: 1, financialYearId: 1, status: 1 });
VoucherSchema.index({ sourceModule: 1, sourceRef: 1 });
// Partial unique index — only enforced on documents that actually carry an
// idempotencyKey, so the many null-key vouchers don't collide.
VoucherSchema.index(
  { societyId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);

VoucherSchema.statics.VOUCHER_TYPES = VOUCHER_TYPES;
VoucherSchema.statics.STATUSES = STATUSES;
VoucherSchema.statics.APPROVAL_STATUSES = APPROVAL_STATUSES;
VoucherSchema.statics.SOURCE_MODULES = SOURCE_MODULES;

export default mongoose.models.Voucher || mongoose.model("Voucher", VoucherSchema);
