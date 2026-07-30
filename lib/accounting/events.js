// Phase 2.6 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.10, §6.13). Typed, in-process event objects — NOT persisted collections.
// These enforce the operational-event / accounting-event boundary: a service
// builds an OperationalEvent from a raw business action, runs its own
// business validation, and only then derives an AccountingEvent. The
// Accounting Engine accepts ONLY an AccountingEvent, so it can assume every
// event it receives is already business-valid and only ever checks
// accounting-level invariants (§9.2), never re-litigates business rules.

// Known accounting event types. Posting rules (Phase 2.7) key off these.
// The set is open for extension — future modules (GST, loans) add their own
// types here and register posting rules against them, without touching the
// engine.
export const EVENT_TYPES = Object.freeze({
  PAYMENT_RECORDED: "PaymentRecorded",
  BILL_GENERATED: "BillGenerated",
  INTEREST_ACCRUED: "InterestAccrued",
  ASSET_PURCHASED: "AssetPurchased",
  DEPRECIATION_POSTED: "DepreciationPosted",
  ASSET_DISPOSED: "AssetDisposed",
  RESERVE_TRANSFER: "ReserveTransfer",
  OPENING_BALANCE: "OpeningBalance",
  MANUAL_ADJUSTMENT: "ManualAdjustment",
});

const EVENT_TYPE_VALUES = Object.freeze(Object.values(EVENT_TYPES));

// Mirrors Voucher.SOURCE_MODULES — kept as a local constant so events.js has
// no dependency on the Mongoose model (this file is pure, no DB access).
const SOURCE_MODULES = Object.freeze([
  "Billing",
  "Payments",
  "Assets",
  "Interest",
  "Manual",
  "Auditor",
  "Migration",
  "OpeningBalance",
  "Import",
]);

export class AccountingEventError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccountingEventError";
    this.status = 400;
  }
}

/**
 * Builds a raw OperationalEvent — the pre-validation representation of a
 * business action. Carries no financialYearId or sourceRef yet; those are
 * resolved during business validation before deriving the AccountingEvent.
 */
export function createOperationalEvent({ type, societyId, actorUserId, payload = {} }) {
  if (!EVENT_TYPE_VALUES.includes(type)) {
    throw new AccountingEventError(`Unknown event type: ${type}`);
  }
  if (!societyId) throw new AccountingEventError("OperationalEvent requires societyId");
  return Object.freeze({
    kind: "OperationalEvent",
    type,
    societyId: String(societyId),
    actorUserId: actorUserId ? String(actorUserId) : null,
    payload,
  });
}

/**
 * Constructs a validated, frozen AccountingEvent — the only thing
 * AccountingEngine.process() accepts. Throws if any accounting-required field
 * is missing, so a malformed event never reaches posting.
 *
 * @param {object} p
 * @param {string} p.type            one of EVENT_TYPES
 * @param {string} p.societyId
 * @param {string} p.financialYearId
 * @param {string} p.sourceModule    one of SOURCE_MODULES
 * @param {string} [p.sourceRef]     id of the originating Bill/Transaction/Asset/etc.
 * @param {string} [p.actorUserId]   becomes voucher.createdBy
 * @param {string} [p.idempotencyKey] optional dedupe guard (§9.2)
 * @param {object} [p.payload]       event-specific data the posting rule reads
 */
export function createAccountingEvent({
  type,
  societyId,
  financialYearId,
  sourceModule,
  sourceRef = null,
  actorUserId = null,
  idempotencyKey = null,
  payload = {},
}) {
  if (!EVENT_TYPE_VALUES.includes(type)) {
    throw new AccountingEventError(`Unknown event type: ${type}`);
  }
  if (!societyId) throw new AccountingEventError("AccountingEvent requires societyId");
  if (!financialYearId) throw new AccountingEventError("AccountingEvent requires financialYearId");
  if (!SOURCE_MODULES.includes(sourceModule)) {
    throw new AccountingEventError(`AccountingEvent has invalid sourceModule: ${sourceModule}`);
  }
  return Object.freeze({
    kind: "AccountingEvent",
    type,
    societyId: String(societyId),
    financialYearId: String(financialYearId),
    sourceModule,
    sourceRef: sourceRef ? String(sourceRef) : null,
    actorUserId: actorUserId ? String(actorUserId) : null,
    idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
    payload,
  });
}

/**
 * Derives an AccountingEvent from an already-business-validated
 * OperationalEvent. This is the concrete boundary crossing — a service calls
 * it only after its own validation has passed, supplying the accounting
 * context (which financial year, what source record) it resolved during
 * validation.
 */
export function deriveAccountingEvent(
  operationalEvent,
  { financialYearId, sourceModule, sourceRef = null, idempotencyKey = null, payload } = {},
) {
  if (!operationalEvent || operationalEvent.kind !== "OperationalEvent") {
    throw new AccountingEventError("deriveAccountingEvent expects an OperationalEvent");
  }
  return createAccountingEvent({
    type: operationalEvent.type,
    societyId: operationalEvent.societyId,
    financialYearId,
    sourceModule,
    sourceRef,
    actorUserId: operationalEvent.actorUserId,
    idempotencyKey,
    payload: payload || operationalEvent.payload,
  });
}

/** Throws unless `event` is a well-formed AccountingEvent. Used by the engine as its front-door guard. */
export function assertAccountingEvent(event) {
  if (!event || event.kind !== "AccountingEvent") {
    throw new AccountingEventError(
      "AccountingEngine.process() only accepts an AccountingEvent built via createAccountingEvent/deriveAccountingEvent",
    );
  }
}
