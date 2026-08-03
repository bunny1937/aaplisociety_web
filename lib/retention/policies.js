/**
 * What expires, when, and whether it may EVER be deleted.
 *
 * These are **platform defaults**, not law. Each society can override
 * `archiveAfterDays` and must individually opt in to `purgeEnabled` — see
 * models/RetentionSetting.js. Nothing here deletes anything on its own.
 *
 * Field meanings:
 *   id                - stable key; also the RetentionSetting override key
 *   modelPath         - import path for the mongoose model
 *   expiryField       - the date field the age test runs against
 *   archiveAfterDays  - age at which a record is offered to the admin as an
 *                       archive. Deliberately SHORTER than ttlBackstopDays so
 *                       the admin gets the download window before anything can
 *                       possibly vanish.
 *   ttlBackstopDays   - the mongo TTL index value. This is the hard floor. If
 *                       every other mechanism fails, this is when Mongo itself
 *                       removes the row.
 *   purgeable         - false means this class is archived for convenience but
 *                       NEVER auto-deleted, no matter what any society sets.
 *   columns           - column order for the exported spreadsheet/table
 *   redact            - fields stripped from the export (large blobs, secrets)
 */
export const RETENTION_POLICIES = [
  {
    id: "notifications",
    label: "Notifications",
    modelPath: "@/models/Notification",
    expiryField: "expiresAt",
    archiveAfterDays: 60,
    ttlBackstopDays: 90,
    purgeable: true,
    columns: [
      "_id",
      "createdAt",
      "type",
      "title",
      "message",
      "recipientType",
      "recipientId",
      "isRead",
      "societyId",
    ],
  },
  {
    id: "visitor-passes",
    label: "Visitor passes & gate log",
    modelPath: "@/models/Visitor",
    expiryField: "createdAt",
    archiveAfterDays: 90,
    ttlBackstopDays: 180,
    purgeable: true,
    columns: [
      "_id",
      "createdAt",
      "name",
      "phone",
      "purpose",
      "flatNo",
      "wing",
      "status",
      "entryMethod",
      "entryTime",
      "exitTime",
      "approvedBy",
    ],
    // Gate photos live in R2 under their own lifecycle rule. The export lists
    // the key, not the image — embedding a few thousand JPEGs would defeat the
    // point of an on-demand bundle.
    redact: ["photoBase64"],
  },
  {
    id: "notices",
    label: "Notices & circulars",
    modelPath: "@/models/Notice",
    expiryField: "createdAt",
    archiveAfterDays: 180,
    ttlBackstopDays: 365,
    purgeable: true,
    columns: [
      "_id",
      "createdAt",
      "title",
      "content",
      "category",
      "postedBy",
      "validUntil",
      "societyId",
    ],
  },
  {
    id: "email-outbox",
    label: "Email delivery log",
    modelPath: "@/models/EmailOutbox",
    expiryField: "purgeAt",
    archiveAfterDays: 14,
    ttlBackstopDays: 30,
    purgeable: true,
    columns: [
      "_id",
      "createdAt",
      "to",
      "type",
      "subject",
      "status",
      "attempts",
      "lastError",
      "sentAt",
    ],
    // The rendered HTML body is by far the largest field and has no audit
    // value once you have the subject, recipient and status.
    redact: ["html"],
  },

  // ---------------------------------------------------------------------
  // purgeable: false — archived on request, never auto-deleted.
  // A society CANNOT opt in to deleting these. The flag is checked in
  // RetentionSetting.resolve() before any override is applied.
  // ---------------------------------------------------------------------
  {
    id: "complaints",
    label: "Complaints & grievances",
    modelPath: "@/models/Complaint",
    expiryField: "createdAt",
    archiveAfterDays: 180,
    ttlBackstopDays: 365,
    purgeable: false,
    // Complaints are evidence. A resident disputing a charge, an escalation to
    // the registrar, or a society election challenge can all turn on a
    // complaint thread from two years ago.
    columns: [
      "_id",
      "createdAt",
      "category",
      "title",
      "description",
      "raisedBy",
      "flatNo",
      "status",
      "resolvedAt",
      "resolutionNote",
    ],
  },
  {
    id: "payment-imports",
    label: "Payment import batches",
    modelPath: "@/models/PaymentImport",
    expiryField: "createdAt",
    archiveAfterDays: 90,
    ttlBackstopDays: 365,
    purgeable: false,
    // Touches money. Society accounts in India are commonly retained for eight
    // years; deleting a reconciliation batch after ninety days would be
    // indefensible in an audit.
    columns: [
      "_id",
      "createdAt",
      "batchId",
      "uploadedBy",
      "fileName",
      "rowCount",
      "matchedCount",
      "unmatchedCount",
      "totalAmount",
      "status",
    ],
  },
];

export function policyById(id) {
  return RETENTION_POLICIES.find((p) => p.id === id) || null;
}

export function purgeablePolicies() {
  return RETENTION_POLICIES.filter((p) => p.purgeable);
}

/** IST calendar date, used as the idempotency key for a nightly run. */
export function istRunDate(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
