// lib/import/importSchema.js
//
// SINGLE SOURCE OF TRUTH for the 6-sheet society import.
//
// This module is imported by BOTH:
//   - app/api/admin/bulk-import/schema/route.js  (serialises it to the client)
//   - app/api/admin/bulk-import/route.js         (re-validates on submit)
//
// That is the whole point. The browser gets the rules once, enforces them
// live on every keystroke, and only POSTs when the entire workbook is clean.
// The server re-runs the identical rules on submit because a client-side
// check is a UX affordance, never a security boundary.
//
// Sheet indices match the existing template route exactly:
//   0  Society
//   1  1. Basic Info (Required)
//   2  2. Additional Details
//   3  3. Parking Slots
//   4  4. Family Members
//   5  5. Owner History
//   6  6. Tenant History

export const SCHEMA_VERSION = "2026-08-03.1";

// ── Reusable validators, expressed as data ──────────────────────────────────
// Everything below must be JSON-serialisable so the exact same object can be
// shipped to the browser. No functions, no regex literals - regexes travel as
// strings and are rebuilt with `new RegExp` on both sides.

export const PATTERNS = {
  email: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$",
  phoneIN: "^[6-9]\\d{9}$",
  pan: "^[A-Z]{5}[0-9]{4}[A-Z]$",
  ifsc: "^[A-Z]{4}0[A-Z0-9]{6}$",
  flatNo: "^[A-Za-z0-9][A-Za-z0-9\\-/ ]{0,15}$",
  wing: "^[A-Za-z0-9]{0,6}$",
  isoDate: "^\\d{4}-\\d{2}-\\d{2}$",
};

export const ENUMS = {
  occupancyType: ["Owner", "Tenant"],
  parkingType: ["Open", "Covered", "Stilt"],
  vehicleType: ["Two-Wheeler", "Four-Wheeler"],
  relation: [
    "Spouse",
    "Son",
    "Daughter",
    "Father",
    "Mother",
    "Brother",
    "Sister",
    "Other",
  ],
  bloodGroup: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
  yesNo: ["Yes", "No"],
};

/**
 * Column descriptor shape:
 *   key        - the exact column name used by the parser (keep the trailing *)
 *   label      - what the admin sees
 *   type       - text | number | email | phone | date | select | money | area
 *   required   - hard-fail when empty
 *   pattern    - PATTERNS key
 *   options    - ENUMS key, for type "select"
 *   min / max  - numeric bounds
 *   width      - grid hint, px
 *   help       - shown in the column header tooltip
 *   unique     - "sheet" for per-sheet uniqueness
 *   fk         - { sheet, column } this value must exist in
 */

const SOCIETY_COLUMNS = [
  { key: "Society Name", label: "Society Name", type: "text", required: true, width: 220 },
  { key: "Registration No", label: "Registration No", type: "text", width: 160 },
  { key: "Date of Registration", label: "Reg. Date", type: "date", pattern: "isoDate", width: 130 },
  { key: "Address", label: "Address", type: "text", required: true, width: 280 },
  { key: "PAN No", label: "PAN", type: "text", pattern: "pan", width: 120, help: "ABCDE1234F" },
  { key: "TAN No", label: "TAN", type: "text", width: 120 },
  { key: "Person of Contact", label: "Contact Person", type: "text", width: 180 },
  { key: "Contact Email", label: "Contact Email", type: "email", pattern: "email", width: 220 },
  { key: "Contact Phone", label: "Contact Phone", type: "phone", pattern: "phoneIN", width: 130 },
  {
    key: "Admin Email",
    label: "Admin Login Email",
    type: "email",
    required: true,
    pattern: "email",
    width: 240,
    help: "The society admin signs in with this. Must not already exist in the platform.",
    remoteCheck: "adminEmailAvailable",
  },
  { key: "Admin Name", label: "Admin Name", type: "text", required: true, width: 180 },
  // Billing config
  { key: "Maintenance Rate", label: "Maintenance /sqft", type: "money", min: 0, width: 140 },
  { key: "Sinking Fund Rate", label: "Sinking Fund /sqft", type: "money", min: 0, width: 140 },
  { key: "Repair Fund Rate", label: "Repair Fund /sqft", type: "money", min: 0, width: 140 },
  { key: "Water Charge", label: "Water (fixed)", type: "money", min: 0, width: 120 },
  { key: "Security Charge", label: "Security (fixed)", type: "money", min: 0, width: 120 },
  { key: "Electricity Charge", label: "Electricity (fixed)", type: "money", min: 0, width: 130 },
  { key: "Interest Rate", label: "Interest % p.a.", type: "number", min: 0, max: 36, width: 120 },
  { key: "Service Tax Rate", label: "Service Tax %", type: "number", min: 0, max: 100, width: 120 },
  { key: "Bill Due Day", label: "Bill Due Day", type: "number", min: 1, max: 28, width: 110 },
  {
    key: "Interest After Days",
    label: "Grace Days",
    type: "number",
    min: 0,
    max: 90,
    width: 110,
  },
];

const BASIC_INFO_COLUMNS = [
  {
    key: "flatNo*",
    label: "Flat No",
    type: "text",
    required: true,
    pattern: "flatNo",
    width: 100,
    unique: "wing+flatNo",
  },
  { key: "wing", label: "Wing", type: "text", pattern: "wing", width: 80, unique: "wing+flatNo" },
  { key: "floor", label: "Floor", type: "number", min: -2, max: 100, width: 80 },
  { key: "ownerName*", label: "Owner Name", type: "text", required: true, width: 200 },
  {
    key: "contactNumber*",
    label: "Contact",
    type: "phone",
    required: true,
    pattern: "phoneIN",
    width: 130,
  },
  {
    key: "emailPrimary*",
    label: "Email",
    type: "email",
    pattern: "email",
    width: 240,
    unique: "ownerScopedEmail",
    help:
      "Login email. The SAME email may repeat across flats owned by the SAME person — " +
      "they get one account with a profile per flat. A repeat under a different owner name is an error.",
    remoteCheck: "memberEmailAvailable",
  },
  {
    key: "carpetAreaSqft*",
    label: "Carpet Area",
    type: "area",
    required: true,
    min: 1,
    max: 20000,
    width: 120,
  },
  { key: "builtUpAreaSqft", label: "Built-up Area", type: "area", min: 0, max: 25000, width: 120 },
  {
    key: "occupancyType",
    label: "Occupancy",
    type: "select",
    options: "occupancyType",
    width: 120,
  },
  { key: "openingPrincipal", label: "Opening Principal", type: "money", min: 0, width: 140 },
  { key: "openingInterest", label: "Opening Interest", type: "money", min: 0, width: 140 },
  { key: "advanceCredit", label: "Advance Credit", type: "money", min: 0, width: 130 },
];

const ADDITIONAL_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "emailSecondary", label: "Alt Email", type: "email", pattern: "email", width: 220 },
  { key: "alternateContact", label: "Alt Contact", type: "phone", pattern: "phoneIN", width: 130 },
  { key: "bloodGroup", label: "Blood Group", type: "select", options: "bloodGroup", width: 110 },
  { key: "dateOfBirth", label: "Date of Birth", type: "date", pattern: "isoDate", width: 130 },
  { key: "panNo", label: "PAN", type: "text", pattern: "pan", width: 120 },
  { key: "aadhaarLast4", label: "Aadhaar (last 4)", type: "text", width: 120, help: "Only the last 4 digits. Never store the full number." },
  { key: "emergencyContactName", label: "Emergency Name", type: "text", width: 180 },
  { key: "emergencyContactPhone", label: "Emergency Phone", type: "phone", pattern: "phoneIN", width: 140 },
];

const PARKING_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "slotNumber", label: "Slot No", type: "text", required: true, width: 110, unique: "sheet" },
  { key: "type", label: "Type", type: "select", options: "parkingType", required: true, width: 120, help: "Stilt slots are never billed monthly." },
  { key: "vehicleType", label: "Vehicle", type: "select", options: "vehicleType", required: true, width: 150 },
];

const FAMILY_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "name", label: "Name", type: "text", required: true, width: 200 },
  { key: "relation", label: "Relation", type: "select", options: "relation", required: true, width: 130 },
  { key: "age", label: "Age", type: "number", min: 0, max: 120, width: 80 },
  { key: "contactNumber", label: "Contact", type: "phone", pattern: "phoneIN", width: 130 },
];

const OWNER_HISTORY_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "ownerName", label: "Previous Owner", type: "text", required: true, width: 200 },
  { key: "fromDate", label: "From", type: "date", pattern: "isoDate", required: true, width: 130 },
  { key: "toDate", label: "To", type: "date", pattern: "isoDate", width: 130, afterField: "fromDate" },
  { key: "emailPrimary", label: "Email", type: "email", pattern: "email", width: 220 },
  { key: "contactNumber", label: "Contact", type: "phone", pattern: "phoneIN", width: 130 },
];

const TENANT_HISTORY_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "name", label: "Tenant Name", type: "text", required: true, width: 200 },
  { key: "email", label: "Email", type: "email", pattern: "email", width: 220 },
  { key: "contactNumber", label: "Contact", type: "phone", pattern: "phoneIN", required: true, width: 130 },
  { key: "leaseStart", label: "Lease Start", type: "date", pattern: "isoDate", required: true, width: 130 },
  { key: "leaseEnd", label: "Lease End", type: "date", pattern: "isoDate", width: 130, afterField: "leaseStart" },
  { key: "isCurrent", label: "Current?", type: "select", options: "yesNo", width: 100, help: "Only one tenant per flat may be marked Current." },
  { key: "rentAmount", label: "Rent", type: "money", min: 0, width: 120 },
  { key: "depositAmount", label: "Deposit", type: "money", min: 0, width: 120 },
];

export const SHEETS = [
  {
    id: "society",
    index: 0,
    excelName: "Society",
    title: "Society",
    subtitle: "One row. Identity, contact and billing configuration.",
    icon: "building",
    mode: "single", // renders as a form, not a grid
    required: true,
    minRows: 1,
    maxRows: 1,
    columns: SOCIETY_COLUMNS,
  },
  {
    id: "basicInfo",
    index: 1,
    excelName: "1. Basic Info (Required)",
    title: "Members",
    subtitle: "One row per flat. This sheet drives every other sheet.",
    icon: "users",
    mode: "grid",
    required: true,
    minRows: 1,
    maxRows: 2000,
    keyColumn: "flatNo*",
    columns: BASIC_INFO_COLUMNS,
  },
  {
    id: "additional",
    index: 2,
    excelName: "2. Additional Details",
    title: "Additional Details",
    subtitle: "Optional. One row per flat, at most.",
    icon: "idcard",
    mode: "grid",
    required: false,
    maxRows: 2000,
    keyColumn: "flatNo*",
    uniqueByKey: true,
    columns: ADDITIONAL_COLUMNS,
  },
  {
    id: "parking",
    index: 3,
    excelName: "3. Parking Slots",
    title: "Parking",
    subtitle: "Optional. Several slots per flat allowed.",
    icon: "car",
    mode: "grid",
    required: false,
    maxRows: 5000,
    keyColumn: "flatNo*",
    columns: PARKING_COLUMNS,
  },
  {
    id: "family",
    index: 4,
    excelName: "4. Family Members",
    title: "Family",
    subtitle: "Optional. Several members per flat allowed.",
    icon: "family",
    mode: "grid",
    required: false,
    maxRows: 8000,
    keyColumn: "flatNo*",
    columns: FAMILY_COLUMNS,
  },
  {
    id: "ownerHistory",
    index: 5,
    excelName: "5. Owner History",
    title: "Owner History",
    subtitle: "Optional. Past owners, for the flat ledger.",
    icon: "history",
    mode: "grid",
    required: false,
    maxRows: 5000,
    keyColumn: "flatNo*",
    columns: OWNER_HISTORY_COLUMNS,
  },
  {
    id: "tenantHistory",
    index: 6,
    excelName: "6. Tenant History",
    title: "Tenant History",
    subtitle: "Optional. Past and current tenants.",
    icon: "key",
    mode: "grid",
    required: false,
    maxRows: 5000,
    keyColumn: "flatNo*",
    columns: TENANT_HISTORY_COLUMNS,
  },
];

// ── Cross-sheet rules ───────────────────────────────────────────────────
// Declared as data so the browser can run them without shipping code.

export const CROSS_RULES = [
  {
    id: "flatMustExist",
    message: "Flat {value} is not in the Members sheet",
    kind: "fk",
    appliesTo: ["additional", "parking", "family", "ownerHistory", "tenantHistory"],
  },
  {
    id: "ownerScopedEmail",
    kind: "ownerScopedEmail",
    sheet: "basicInfo",
    emailColumn: "emailPrimary*",
    ownerColumn: "ownerName*",
    message:
      'Email "{value}" is already used by a different owner ({other}). ' +
      "Reusing an email is only allowed when the same person owns several flats.",
  },
  {
    id: "oneCurrentTenant",
    kind: "atMostOne",
    sheet: "tenantHistory",
    groupBy: "flatNo*",
    whenColumn: "isCurrent",
    whenValue: "Yes",
    message: "Flat {group} has more than one tenant marked Current",
  },
  {
    id: "additionalOnePerFlat",
    kind: "uniqueByKey",
    sheet: "additional",
    column: "flatNo*",
    message: "Flat {value} appears more than once in Additional Details",
  },
  {
    id: "builtUpGteCarpet",
    kind: "compareColumns",
    sheet: "basicInfo",
    left: "builtUpAreaSqft",
    op: ">=",
    right: "carpetAreaSqft*",
    skipWhenEmpty: true,
    message: "Built-up area cannot be smaller than carpet area",
  },
];

/** Everything the client needs, in one payload. */
export function buildClientSchema() {
  return {
    schemaVersion: SCHEMA_VERSION,
    patterns: PATTERNS,
    enums: ENUMS,
    sheets: SHEETS,
    crossRules: CROSS_RULES,
    limits: {
      maxTotalRows: 20000,
      maxPayloadBytes: 4_000_000, // Vercel's hard body limit is 4.5 MB
    },
  };
}

export function getSheet(id) {
  return SHEETS.find((s) => s.id === id);
}
