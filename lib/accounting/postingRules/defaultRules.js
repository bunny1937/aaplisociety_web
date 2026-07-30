import { EVENT_TYPES } from "@/lib/accounting/events.js";

// Phase 2.7 — the seeded default-tier posting rules (societyId: null). These
// cover the accounting events the current billing system actually produces,
// plus generic manual/opening-balance rules. They are DATA, not code: an
// admin can add per-society overrides (higher-priority rules that shadow
// these) without touching the engine.
//
// IMPORTANT: these rules reference accounts by resolver KEY only. They post
// nothing until a society has (a) enabled accounting, (b) built its Chart of
// Accounts, and (c) mapped the named accounts in its fiscal configuration.
// Until then, resolveAccountKey throws a clear "not configured" error and the
// engine rolls back — no half-posted vouchers.

export const DEFAULT_POSTING_RULES = [
  // ── Payment received (Cash) ────────────────────────────────────────────────
  // Dr Cash, Cr Member Receivable. Higher priority than the bank default so a
  // Cash payment matches this first.
  {
    systemKey: "default:PaymentRecorded:cash",
    eventType: EVENT_TYPES.PAYMENT_RECORDED,
    description: "Payment received in cash",
    voucherType: "Receipt",
    priority: 10,
    conditions: [{ field: "paymentMode", op: "eq", value: "Cash" }],
    lineSpecs: [
      { accountKey: "cash", side: "Debit", amountKey: "amount", narration: "Cash received" },
      { accountKey: "memberReceivable", side: "Credit", amountKey: "amount", narration: "Against member dues" },
    ],
  },
  // ── Payment received (bank/other, default) ─────────────────────────────────
  {
    systemKey: "default:PaymentRecorded:bank",
    eventType: EVENT_TYPES.PAYMENT_RECORDED,
    description: "Payment received to bank (default)",
    voucherType: "Receipt",
    priority: 1,
    conditions: [],
    lineSpecs: [
      { accountKey: "defaultBank", side: "Debit", amountKey: "amount", narration: "Bank receipt" },
      { accountKey: "memberReceivable", side: "Credit", amountKey: "amount", narration: "Against member dues" },
    ],
  },
  // ── Bill generated ─────────────────────────────────────────────────────────
  // Dr Member Receivable (full bill), Cr Maintenance Income (current charges),
  // Cr Interest Income (current interest, optional — skipped when zero).
  // Balances iff totalBillDue == currentCharges + currentInterest, which the
  // engine's assertBalanced enforces.
  {
    systemKey: "default:BillGenerated",
    eventType: EVENT_TYPES.BILL_GENERATED,
    description: "Maintenance bill raised on a member",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    lineSpecs: [
      { accountKey: "memberReceivable", side: "Debit", amountKey: "totalBillDue", narration: "Bill raised" },
      { accountKey: "maintenanceIncome", side: "Credit", amountKey: "currentCharges", narration: "Maintenance charges" },
      { accountKey: "interestIncome", side: "Credit", amountKey: "currentInterest", optional: true, narration: "Interest on arrears" },
    ],
  },
  // ── Interest accrued (standalone) ──────────────────────────────────────────
  {
    systemKey: "default:InterestAccrued",
    eventType: EVENT_TYPES.INTEREST_ACCRUED,
    description: "Interest accrued on overdue dues",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    lineSpecs: [
      { accountKey: "memberReceivable", side: "Debit", amountKey: "interestAmount", narration: "Interest charged" },
      { accountKey: "interestIncome", side: "Credit", amountKey: "interestAmount", narration: "Interest income" },
    ],
  },
  // ── Manual journal voucher ─────────────────────────────────────────────────
  // The user picks the accounts/amounts; the payload carries the full lines.
  {
    systemKey: "default:ManualAdjustment",
    eventType: EVENT_TYPES.MANUAL_ADJUSTMENT,
    description: "Manual/adjustment journal voucher (lines supplied by user)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Opening balance ────────────────────────────────────────────────────────
  // The Opening Balance Wizard (Phase 2.10) supplies the lines.
  {
    systemKey: "default:OpeningBalance",
    eventType: EVENT_TYPES.OPENING_BALANCE,
    description: "Opening balance entry (lines supplied by wizard)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Asset purchase ─────────────────────────────────────────────────────────
  // The Asset Register (Phase 2.11) knows the asset's linked Fixed Asset
  // account and the funding (bank/cash) account, so it supplies the lines:
  // Dr Fixed Asset, Cr Bank/Cash.
  {
    systemKey: "default:AssetPurchased",
    eventType: EVENT_TYPES.ASSET_PURCHASED,
    description: "Fixed asset purchased (lines supplied by Asset Register)",
    voucherType: "Payment",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Depreciation ───────────────────────────────────────────────────────────
  // Dr Depreciation Expense, Cr Accumulated Depreciation (per asset).
  {
    systemKey: "default:DepreciationPosted",
    eventType: EVENT_TYPES.DEPRECIATION_POSTED,
    description: "Depreciation charged (lines supplied by Asset Register)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Asset disposal ─────────────────────────────────────────────────────────
  // Removes cost + accumulated depreciation, books sale proceeds and gain/loss.
  {
    systemKey: "default:AssetDisposed",
    eventType: EVENT_TYPES.ASSET_DISPOSED,
    description: "Fixed asset disposed (lines supplied by Asset Register)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
];
