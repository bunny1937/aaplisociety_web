/**
 * POST /api/admin/bulk-import
 * Phase 1: validate everything — return errors without touching DB.
 * Phase 2: create society → admin user → members, atomically, tagged with
 *          an importRunId so a crash/retry can be detected and compensated
 *          instead of leaving partial data or double-importing.
 *
 * State machine (see BulkImportRun.status):
 *   VALIDATING → IMPORTING → FINALIZING → COMMITTED → EMAIL_QUEUED → COMPLETED
 *   terminal failure states: FAILED / ROLLED_BACK
 *
 * The client sends a stable importRunId (generated once, kept across
 * refresh/retry in sessionStorage — see admin UI). Duplicate submits with the
 * same key are rejected while a run is in flight, and a COMPLETED run replays
 * its cached result instead of re-importing.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import BulkImportRun from "@/models/BulkImportRun";
import EmailOutbox from "@/models/EmailOutbox";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { generateSimpleUsername, buildUsernameBloomFilter } from "@/lib/username-generator";
import { generateUniqueSocietyCode } from "@/lib/society-code";
import { generatePassword } from "@/lib/password-generator";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
import { signToken } from "@/lib/jwt";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STALE_RUN_MS = 3 * 60 * 1000; // an in-flight run with no update in 3 min is presumed crashed

function generateSocietyId(name) {
  const parts = name.trim().split(" ");
  const first = parts[0]?.slice(0, 4).toLowerCase() || "soc";
  const last = parts[parts.length - 1]?.slice(0, 4).toLowerCase() || "ety";
  const year = new Date().getFullYear();
  const rand = String(Math.floor(10 + Math.random() * 90));
  return `${first}_${last}_${year}_${rand}`;
}

function rowToSocietyPayload(row) {
  const charges = [
    {
      label: "Maintenance Charges",
      type: "Per Sq Ft",
      vehicleType: null,
      value: parseFloat(row["Maintenance Rate (Per Sq Ft)"]) || 0,
      isActive: true,
    },
    {
      label: "Sinking Fund",
      type: "Per Sq Ft",
      vehicleType: null,
      value: parseFloat(row["Sinking Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
    },
    {
      label: "Repair Fund",
      type: "Per Sq Ft",
      vehicleType: null,
      value: parseFloat(row["Repair Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
    },
    {
      label: "Water Charges",
      type: "Fixed",
      vehicleType: null,
      value: parseFloat(row["Water Charges (Fixed)"]) || 0,
      isActive: true,
    },
    {
      label: "Security Charges",
      type: "Fixed",
      vehicleType: null,
      value: parseFloat(row["Security Charges (Fixed)"]) || 0,
      isActive: true,
    },
    {
      label: "Electricity Charges",
      type: "Fixed",
      vehicleType: null,
      value: parseFloat(row["Electricity Charges (Fixed)"]) || 0,
      isActive: true,
    },
    {
      label: "Open Parking - Two Wheeler",
      type: "Per Vehicle",
      vehicleType: "Two-Wheeler",
      value: parseFloat(row["Open Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking TW (Per Vehicle)"]) > 0,
    },
    {
      label: "Open Parking - Four Wheeler",
      type: "Per Vehicle",
      vehicleType: "Four-Wheeler",
      value: parseFloat(row["Open Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking FW (Per Vehicle)"]) > 0,
    },
    {
      label: "Covered Parking - Two Wheeler",
      type: "Per Vehicle",
      vehicleType: "Two-Wheeler",
      value: parseFloat(row["Covered Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking TW (Per Vehicle)"]) > 0,
    },
    {
      label: "Covered Parking - Four Wheeler",
      type: "Per Vehicle",
      vehicleType: "Four-Wheeler",
      value: parseFloat(row["Covered Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking FW (Per Vehicle)"]) > 0,
    },
  ];
  return {
    societyName: row["Society Name"]?.toString().trim(),
    registrationNo: row["Registration No"]?.toString().trim() || "",
    address: row["Address"]?.toString().trim() || "",
    dateOfRegistration: row["Date of Registration"]?.toString().trim() || "",
    panNo: row["PAN No"]?.toString().trim() || "",
    tanNo: row["TAN No"]?.toString().trim() || "",
    fullName: row["Admin Full Name"]?.toString().trim(),
    email: row["Admin Email"]?.toString().trim().toLowerCase(),
    personOfContact: row["Contact Person"]?.toString().trim() || "",
    contactEmail: row["Contact Email"]?.toString().trim() || "",
    contactPhone: row["Contact Phone"]?.toString().trim() || "",
    config: {
      charges,
      interestRate: parseFloat(row["Interest Rate %"]) || 21,
      interestAfterDays: parseInt(row["Bill Payment Due After (Days)"]) || 15,
    },
  };
}

function parseDateOrNull(value) {
  if (!value && value !== 0) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function yes(value) {
  return ["yes", "true", "1", "y"].includes(String(value ?? "").trim().toLowerCase());
}
function parseMemberRows(
  basicInfoRows,
  parkingByFlat,
  additionalByFlat = {},
  familyByFlat = {},
  ownersByFlat = {},
  tenantsByFlat = {},
) {
  const members = [];
  const errors = [];
  const seenFlats = new Set();
  const seenEmails = new Set();
  for (let i = 0; i < basicInfoRows.length; i++) {
    const row = basicInfoRows[i];
    // The template separates real data from the trailing instructions/notes
    // block with one fully blank row. Stop here — everything below is notes,
    // not member data (e.g. "* = Required fields", "RULE: ...").
    if (Object.values(row).every((v) => v === "" || v == null)) break;
    const flatNo = String(row["flatNo*"] || row["flatNo"] || "").trim();
    const wing = String(row["wing"] || "").trim();
    // Skip instruction / header echo rows (defense in depth, in case the
    // blank separator row above is missing)
    if (flatNo.toUpperCase().startsWith("INSTRUCTION") || flatNo === "flatNo*")
      continue;
    if (!flatNo) {
      errors.push({
        label: `Row ${i + 2}`,
        errors: ["Missing required field(s): 'flatNo*'"],
      });
      continue;
    }
    const label = `Row ${i + 2} (${wing}-${flatNo})`;
    // Required field checks
    const rowErrors = [];
    if (!String(row["ownerName*"] || row["ownerName"] || "").trim())
      rowErrors.push("ownerName is required");
    if (!String(row["contactNumber*"] || row["contactNumber"] || "").trim())
      rowErrors.push("contactNumber is required");
    const carpetArea = parseFloat(
      row["carpetAreaSqft*"] || row["carpetAreaSqft"] || 0,
    );
    if (!carpetArea || carpetArea <= 0)
      rowErrors.push("carpetAreaSqft must be > 0");
    const emailRaw = String(row["emailPrimary*"] || row["emailPrimary"] || "")
      .trim()
      .toLowerCase();
    if (emailRaw && !EMAIL_RE.test(emailRaw))
      rowErrors.push(`emailPrimary "${emailRaw}" is not a valid email`);
    const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;
    if (seenFlats.has(flatKey)) {
      rowErrors.push(`Duplicate flat ${wing}-${flatNo} in member sheet`);
    } else {
      seenFlats.add(flatKey);
    }
    if (emailRaw) {
      if (seenEmails.has(emailRaw)) {
        rowErrors.push(`Duplicate email "${emailRaw}" in member sheet`);
      } else {
        seenEmails.add(emailRaw);
      }
    }
    if (rowErrors.length) {
      errors.push({ label, errors: rowErrors });
      continue;
    }
    const openingPrincipal = parseFloat(row["openingPrincipal"] || 0) || 0;
    const openingInterest = parseFloat(row["openingInterest"] || 0) || 0;
    const slots = (parkingByFlat[flatNo] || [])
      .map((p) => ({
        slotNumber: String(p["slotNumber"] || "").trim(),
        type: String(p["type"] || "Open").trim(),
        vehicleType: String(p["vehicleType"] || "Two-Wheeler").trim(),
        monthlyBilling: String(p["type"] || "").trim() !== "Stilt",
      }))
      .filter((s) => s.slotNumber);
    const additional = additionalByFlat[flatNo] || {};
    const familyMembers = (familyByFlat[flatNo] || []).map((f) => ({
      name: String(f.name || "").trim(),
      relation: String(f.relation || "").trim(),
      age: f.age === "" || f.age == null ? undefined : Number(f.age),
      contactNumber: String(f.contactNumber || "").trim(),
      occupation: String(f.occupation || "").trim(),
    })).filter((f) => f.name);
    const ownerHistory = (ownersByFlat[flatNo] || []).map((o) => ({
      ownerName: String(o.ownerName || "").trim(),
      contactNumber: String(o.contactNumber || "").trim(),
      emailPrimary: String(o.emailPrimary || "").trim().toLowerCase(),
      panCard: String(o.panCard || "").trim(),
      ownershipStartDate: parseDateOrNull(o.ownershipStartDate),
      ownershipEndDate: parseDateOrNull(o.ownershipEndDate),
      purchaseAmount: Number(o.purchaseAmount || 0),
      saleAmount: Number(o.saleAmount || 0),
      isCurrent: false,
    })).filter((o) => o.ownerName && o.contactNumber && o.ownershipStartDate);
    const allTenants = (tenantsByFlat[flatNo] || []).map((t) => ({
      name: String(t.name || "").trim(),
      contactNumber: String(t.contactNumber || "").trim(),
      email: String(t.email || "").trim().toLowerCase(),
      panCard: String(t.panCard || "").trim(),
      startDate: parseDateOrNull(t.startDate),
      endDate: parseDateOrNull(t.endDate),
      depositAmount: Number(t.depositAmount || 0),
      rentPerMonth: Number(t.rentPerMonth || 0),
      isCurrent: yes(t.isCurrent),
    })).filter((t) => t.name && t.contactNumber && t.startDate);
    const currentTenant = allTenants.find((t) => t.isCurrent) || null;
    members.push({
      flatNo,
      wing,
      floor: row.floor === "" || row.floor == null ? undefined : Number(row.floor),
      ownerName: String(row["ownerName*"] || row["ownerName"] || "").trim(),
      carpetAreaSqft: carpetArea,
      builtUpAreaSqft: additional.builtUpAreaSqft === "" || additional.builtUpAreaSqft == null ? undefined : Number(additional.builtUpAreaSqft),
      flatType: String(row.flatType || "2BHK").trim(),
      ownershipType: String(row.ownershipType || "Owner-Occupied").trim(),
      contactNumber: String(row["contactNumber*"] || row["contactNumber"] || "").trim(),
      emailPrimary: emailRaw || null,
      alternateContact: String(additional.alternateContact || "").trim(),
      whatsappNumber: String(additional.whatsappNumber || "").trim(),
      emailSecondary: String(additional.emailSecondary || "").trim().toLowerCase(),
      panCard: String(additional.panCard || "").trim(),
      aadhaar: String(additional.aadhaar || "").trim(),
      possessionDate: parseDateOrNull(additional.possessionDate),
      openingPrincipal,
      openingInterest,
      openingBalance: parseFloat((openingPrincipal + openingInterest).toFixed(2)),
      parkingSlots: slots,
      familyMembers,
      ownerHistory,
      tenantHistory: allTenants,
      currentTenant,
      isDeleted: false,
      advanceCredit: 0,
    });
  }
  return { members, errors };
}

// Single rollback path for the whole import, regardless of which phase
// failed — every document created by an import carries importRunId (Bill
// uses the pre-existing importBatchId field for the same purpose), so
// compensation never has to be kept in sync with a second, hand-maintained
// list of "what this phase created".
async function compensateImportRun(importRunId) {
  if (!importRunId) return;
  try {
    await Promise.all([
      Bill.deleteMany({ importBatchId: importRunId }),
      Transaction.deleteMany({ importRunId }),
      BillingHead.deleteMany({ importRunId }),
      Member.deleteMany({ importRunId }),
      User.deleteMany({ importRunId }),
      Society.deleteMany({ importRunId }),
      EmailOutbox.deleteMany({ importRunId }),
    ]);
  } catch (cleanupErr) {
    console.error(
      `[bulk-import] compensation cleanup failed for run ${importRunId}:`,
      cleanupErr.message,
    );
  }
}

async function markRun(importRunId, patch) {
  try {
    await BulkImportRun.updateOne({ importRunId }, { $set: patch });
  } catch (err) {
    console.error("[bulk-import] status update failed:", err.message);
  }
}

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  await connectDB();
  const formData = await request.formData();
  const file = formData.get("file");
  const importRunId =
    String(formData.get("importRunId") || "").trim() ||
    new mongoose.Types.ObjectId().toString();
  if (!file)
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  // ── IDEMPOTENCY / DUPLICATE-SUBMIT GUARD ─────────────────────────────
  const existingRun = await BulkImportRun.findOne({ importRunId });
  if (existingRun) {
    if (existingRun.status === "COMPLETED") {
      return NextResponse.json({ ...existingRun.result, replay: true, importRunId });
    }
    if (existingRun.status !== "FAILED" && existingRun.status !== "ROLLED_BACK") {
      const ageMs = Date.now() - new Date(existingRun.updatedAt).getTime();
      if (ageMs < STALE_RUN_MS) {
        return NextResponse.json(
          {
            error:
              "An import with this key is already running — wait for it to finish before retrying.",
            importRunId,
            status: existingRun.status,
          },
          { status: 409 },
        );
      }
      // Presumed-crashed run (no progress for 3+ min). Anything it actually
      // wrote is tagged with this importRunId and gets swept here before we
      // let a fresh attempt reuse the key.
      await compensateImportRun(importRunId);
    }
  }
  await BulkImportRun.findOneAndUpdate(
    { importRunId },
    {
      importRunId,
      status: "VALIDATING",
      stage: "Parsing workbook",
      processedCount: 0,
      totalCount: 0,
      warnings: [],
      errorMessages: [],
      result: null,
      startedAt: new Date(),
      finishedAt: null,
    },
    { upsert: true },
  );

  const fail = async (body, status) => {
    await markRun(importRunId, {
      status: "FAILED",
      errorMessages: body.errors || [body.error].filter(Boolean),
      finishedAt: new Date(),
    });
    return NextResponse.json({ ...body, importRunId }, { status });
  };

  const bytes = await file.arrayBuffer();
  const wb = XLSX.read(Buffer.from(bytes), { cellDates: true });
  if (wb.SheetNames.length < 1) {
    return fail(
      {
        error:
          "File must have at least 1 sheet (Society data in Sheet 'Society')",
      },
      400,
    );
  }
  // ── PHASE 1: PARSE ────────────────────────────────────────────────
  // Society sheet
  const societySheet = wb.Sheets[wb.SheetNames[0]];
  const societyRows = XLSX.utils.sheet_to_json(societySheet, { defval: "" });
  if (!societyRows.length) {
    return fail(
      {
        validationFailed: true,
        phase: "society",
        errors: [
          "Sheet 'Society' has no data rows. Fill in the first row with society details.",
        ],
      },
      422,
    );
  }
  if (societyRows.length > 1) {
    return fail(
      {
        validationFailed: true,
        phase: "society",
        errors: [
          `Sheet 'Society' has ${societyRows.length} data rows — it must have exactly 1. ` +
            `The template ships with a pre-filled SAMPLE row (Godbole Heights / admin@godboleheights.com) as an example. ` +
            `Edit that row in place with your real data — do NOT add a new row below it, ` +
            `the system always reads row 1 and would silently use the sample instead of yours.`,
        ],
      },
      422,
    );
  }
  const societyPayload = rowToSocietyPayload(societyRows[0]);
  // Member sheet (index 1 = "1. Basic Info (Required)")
  const basicInfoSheetName = wb.SheetNames[1];
  const basicInfoRows = basicInfoSheetName
    ? XLSX.utils.sheet_to_json(wb.Sheets[basicInfoSheetName], {
        defval: "",
        blankrows: true,
      })
    : [];
  // Parking sheet (index 3 = "3. Parking Slots")
  const parkingSheetName = wb.SheetNames[3];
  const parkingByFlat = {};
  if (parkingSheetName && wb.Sheets[parkingSheetName]) {
    for (const p of XLSX.utils.sheet_to_json(wb.Sheets[parkingSheetName], {
      defval: "",
    })) {
      const fn = String(p["flatNo"] || "").trim();
      if (!fn || fn.toUpperCase().startsWith("INSTRUCTION") || fn === "flatNo")
        continue;
      if (!parkingByFlat[fn]) parkingByFlat[fn] = [];
      parkingByFlat[fn].push(p);
    }
  }
  function rowsFor(prefix) {
    const name = wb.SheetNames.find((n) => n.startsWith(prefix));
    return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" }) : [];
  }
  function groupByFlat(rows) {
    const out = {};
    for (const r of rows) {
      const flat = String(r["flatNo*"] || r.flatNo || "").trim();
      if (!flat || flat.toUpperCase().startsWith("INSTRUCTION")) continue;
      (out[flat] ||= []).push(r);
    }
    return out;
  }
  const additionalByFlat = Object.fromEntries(
    rowsFor("2. Additional").map((r) => [String(r["flatNo*"] || r.flatNo || "").trim(), r]),
  );
  const familyByFlat = groupByFlat(rowsFor("4. Family"));
  const ownersByFlat = groupByFlat(rowsFor("5. Owner"));
  const tenantsByFlat = groupByFlat(rowsFor("6. Tenant"));
  // ── PHASE 2: VALIDATE (nothing written to DB yet) ─────────────────
  const societyErrors = [];
  if (!societyPayload.societyName)
    societyErrors.push("Society Name is required");
  if (!societyPayload.fullName)
    societyErrors.push("Admin Full Name is required");
  if (!societyPayload.email) societyErrors.push("Admin Email is required");
  else if (!EMAIL_RE.test(societyPayload.email))
    societyErrors.push(`Admin Email "${societyPayload.email}" is not valid`);
  // DB uniqueness checks (read-only, no writes)
  if (societyPayload.societyName) {
    const nameExists = await Society.findOne({
      name: societyPayload.societyName,
      isDeleted: { $ne: true },
    });
    if (nameExists)
      societyErrors.push(
        `Society "${societyPayload.societyName}" already exists in the system (id: ${nameExists.societyId})`,
      );
  }
  if (societyPayload.email) {
    const emailExists = await User.findOne({ email: societyPayload.email });
    if (emailExists)
      societyErrors.push(
        `Admin email "${societyPayload.email}" is already registered — choose a different email`,
      );
  }
  // Billing heads warning
  const activeCharges = societyPayload.config.charges.filter(
    (c) => c.value > 0,
  );
  const warnings = [];
  if (activeCharges.length === 0) {
    warnings.push(
      "No billing head rates filled in Society sheet — all charges are ₹0. You can update them in Society Config after import, but bills generated will be ₹0 until then.",
    );
  }
  if (societyErrors.length) {
    return fail({ validationFailed: true, phase: "society", errors: societyErrors, warnings }, 422);
  }
  // Member validation
  const { members: validMembers, errors: memberErrors } = parseMemberRows(
    basicInfoRows,
    parkingByFlat,
    additionalByFlat,
    familyByFlat,
    ownersByFlat,
    tenantsByFlat,
  );
  if (memberErrors.length) {
    return fail(
      {
        validationFailed: true,
        phase: "members",
        errors: memberErrors.map((e) => `${e.label}: ${e.errors.join("; ")}`),
        warnings,
        memberRowsTotal: validMembers.length + memberErrors.length,
        memberRowsValid: validMembers.length,
        memberRowsFailed: memberErrors.length,
      },
      422,
    );
  }
  if (validMembers.length === 0) {
    const hint =
      basicInfoRows.length > 0
        ? `Sheet has ${basicInfoRows.length} data rows but none could be parsed — check that the 'flatNo*' column is filled and not renamed.`
        : "Sheet '1. Basic Info (Required)' is empty.";
    return fail({ validationFailed: true, phase: "members", errors: [hint], warnings }, 422);
  }
  // Member email uniqueness — checked here (read-only, no writes yet) so a
  // clash aborts the whole import instead of silently merging into an
  // existing account during Phase 3.
  const memberEmails = [
    ...new Set(validMembers.filter((m) => m.emailPrimary).map((m) => m.emailPrimary)),
  ];
  const existingUsersByEmail = new Map();
  if (memberEmails.length > 0) {
    const existingUsers = await User.find({ email: { $in: memberEmails } });
    if (existingUsers.length > 0) {
      const existingEmailSet = new Set(existingUsers.map((u) => u.email));
      const emailErrors = validMembers
        .filter((m) => m.emailPrimary && existingEmailSet.has(m.emailPrimary))
        .map(
          (m) =>
            `${m.wing}-${m.flatNo}: email "${m.emailPrimary}" is already registered to another account — choose a different email or remove this row`,
        );
      return fail({ validationFailed: true, phase: "members", errors: emailErrors, warnings }, 422);
    }
    // (Left in place for defense-in-depth: the check above currently rejects
    // the whole import on any collision, so this map is always empty here —
    // but if that policy ever relaxes to "merge into existing account",
    // this one bulk lookup avoids re-introducing an N+1 findOne per member.)
    for (const u of existingUsers) existingUsersByEmail.set(u.email, u);
  }
  await markRun(importRunId, {
    status: "IMPORTING",
    stage: "Creating society, users, and members",
    totalCount: validMembers.length,
  });
  // ── PHASE 3: CREATE (society + admin + members + member users + billing heads), ATOMIC ──
  let societyId,
    attempts = 0;
  do {
    societyId = generateSocietyId(societyPayload.societyName);
    if (!(await Society.findOne({ societyId }))) break;
  } while (++attempts < 10);
  const societyCode = await generateUniqueSocietyCode();
  const plainPassword = generatePassword();
  const usernameBloom = await buildUsernameBloomFilter();
  const noEmailMembers = validMembers.filter((m) => !m.emailPrimary);
  if (noEmailMembers.length > 0) {
    warnings.push(
      `${noEmailMembers.length} member(s) had no emailPrimary — no login account or onboarding email created for: ${noEmailMembers.map((m) => `${m.wing}-${m.flatNo}`).join(", ")}`,
    );
  }
  // Do the CPU-bound work (bcrypt, username generation) BEFORE opening the
  // transaction, in parallel — this is what was blowing the import out to
  // 2-4 minutes (sequential bcrypt.hash + a findOne round-trip per member,
  // one member at a time, all inside a single request). Mongo transactions
  // also have a bounded lifetime, so keeping only fast DB ops inside
  // session.withTransaction matters, not just speed.
  const [adminHash, memberPrep] = await Promise.all([
    bcrypt.hash(plainPassword, 10),
    Promise.all(
      validMembers.map(async (memberData) => {
        if (!memberData.emailPrimary) return { memberData };
        const memberPwd = generatePassword();
        const memberHash = await bcrypt.hash(memberPwd, 10);
        // Username generation shares one Bloom filter across the batch, so
        // it must stay sequential (each call may add to the filter) even
        // though bcrypt hashing above runs in parallel across members.
        const username = await generateSimpleUsername(societyCode, memberData.flatNo, usernameBloom);
        return { memberData, memberPwd, memberHash, username };
      }),
    ),
  ]);

  let society;
  let billingHeads = [];
  const memberCredentials = [];
  const memberCreateErrors = [];
  let membersCreated = 0;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [createdSociety] = await Society.create(
        [
          {
            name: societyPayload.societyName,
            societyId,
            societyCode,
            registrationNo: societyPayload.registrationNo || undefined,
            address: societyPayload.address,
            panNo: societyPayload.panNo,
            tanNo: societyPayload.tanNo,
            config: societyPayload.config,
            credentials: { adminEmail: societyPayload.email, plainPassword },
            subscription: { status: "Trial", startDate: new Date() },
            isDeleted: false,
            importRunId,
            importStatus: "importing",
          },
        ],
        { session },
      );
      society = createdSociety;

      await User.create(
        [
          {
            name: societyPayload.fullName,
            email: societyPayload.email,
            password: adminHash,
            role: "Admin",
            societyId: society._id,
            profiles: [],
            isActive: true,
            importRunId,
          },
        ],
        { session },
      );

      for (const prep of memberPrep) {
        const memberData = prep.memberData;
        const [member] = await Member.create(
          [{ ...memberData, societyId: society._id, importRunId }],
          { session },
        );
        if (memberData.emailPrimary) {
          const existingUser = existingUsersByEmail.get(memberData.emailPrimary);
          if (existingUser) {
            const profileId = new mongoose.Types.ObjectId();
            await User.updateOne(
              { _id: existingUser._id },
              {
                $push: {
                  profiles: {
                    profileId,
                    societyId: society._id,
                    memberId: member._id,
                    flatNo: memberData.flatNo,
                    wing: memberData.wing,
                    isPrimary: false,
                    status: "Active",
                    joinedAt: new Date(),
                  },
                },
              },
              { session },
            );
            memberCredentials.push({
              flatNo: memberData.flatNo,
              wing: memberData.wing,
              ownerName: memberData.ownerName,
              email: memberData.emailPrimary,
              password: "(existing account — original password unchanged)",
              isNewUser: false,
            });
          } else {
            const [newUser] = await User.create(
              [
                {
                  name: memberData.ownerName,
                  email: memberData.emailPrimary,
                  username: prep.username,
                  phone: memberData.contactNumber || null,
                  password: prep.memberHash,
                  role: "Member",
                  societyId: society._id,
                  mustChangePassword: true,
                  profiles: [
                    {
                      profileId: new mongoose.Types.ObjectId(),
                      societyId: society._id,
                      memberId: member._id,
                      flatNo: memberData.flatNo,
                      wing: memberData.wing,
                      isPrimary: true,
                      status: "Active",
                      joinedAt: new Date(),
                    },
                  ],
                  isActive: true,
                  importRunId,
                },
              ],
              { session },
            );
            memberCredentials.push({
              userId: newUser._id,
              flatNo: memberData.flatNo,
              wing: memberData.wing,
              ownerName: memberData.ownerName,
              username: prep.username,
              email: memberData.emailPrimary,
              password: prep.memberPwd,
              isNewUser: true,
            });
          }
        }
        membersCreated++;
      }

      const headsToCreate = societyPayload.config.charges
        .filter((c) => (c.label || c.name)?.trim() && c.isActive !== false)
        .map((c, i) => ({
          headName: (c.label || c.name || "").trim(),
          calculationType: c.type === "Per Sq Ft" ? "Per Sq Ft" : "Fixed",
          defaultAmount: Number(c.value) || 0,
          isActive: true,
          isDeleted: false,
          order: i + 1,
          societyId: society._id,
          importRunId,
        }));
      if (headsToCreate.length > 0) {
        billingHeads = await BillingHead.create(headsToCreate, { session, ordered: true });
      } else {
        warnings.push(
          "No billing heads created — all charge values were 0 in the Society sheet.",
        );
      }
    });
  } catch (err) {
    session.endSession();
    await compensateImportRun(importRunId);
    return fail(
      {
        validationFailed: true,
        phase: memberCreateErrors.length ? "members" : "society",
        errors: [err.message],
        warnings,
        rollback: true,
      },
      500,
    );
  }
  session.endSession();
  await markRun(importRunId, {
    status: "FINALIZING",
    stage: "Generating current-month bills",
    societyId: society._id,
    processedCount: membersCreated,
  });

  // ── PHASE 5: GENERATE CURRENT MONTH BILLS ────────────────────────
  // generateBill/applyPaymentToBill each manage their own internal
  // transaction, so this phase runs after Phase 3 commits rather than nested
  // inside it. Any failure here is compensated the same way as a Phase 3
  // failure: delete everything tagged with this importRunId.
  const now = new Date();
  const billYear = now.getFullYear();
  const billMonth = now.getMonth() + 1; // 1-indexed
  const billPeriod = `${billYear}-${String(billMonth).padStart(2, "0")}`;
  const startDate = new Date(billYear, billMonth - 1, 1);
  const financialYear =
    billMonth >= 4
      ? `${billYear}-${billYear + 1}`
      : `${billYear - 1}-${billYear}`;
  let billsGenerated = 0;
  const billErrors = [];
  if (billingHeads.length > 0 && membersCreated > 0) {
    const allMembers = await Member.find({
      societyId: society._id,
      isDeleted: { $ne: true },
    }).lean();
    for (const member of allMembers) {
      try {
        // Ledger V2: the canonical GenerationService owns opening/current/
        // interest math — no independent calculation here. First-ever bill
        // for a member seeds openingPrincipal/openingInterest from the
        // Member doc (set from the import sheet), same as before.
        const bill = await generateBill({
          societyId: society._id,
          memberId: member._id,
          year: billYear,
          month: billMonth,
          performedBy: "System",
        });
        await Bill.updateOne(
          { _id: bill._id },
          { $set: { importBatchId: importRunId, importedFrom: "BulkImport" } },
        );
        if (bill.status !== "Scheduled" && (member.advanceCredit || 0) > 0) {
          const applied = Math.min(
            parseFloat(member.advanceCredit.toFixed(2)),
            bill.totalBillDue,
          );
          if (applied > 0) {
            await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: "System" });
            await Member.updateOne({ _id: member._id }, { $inc: { advanceCredit: -applied } });
          }
        }
        const transactionId = Transaction.generateTransactionId();
        const newBalance = (member.openingBalance || 0) + bill.currentCharges;
        await Transaction.create({
          transactionId,
          societyId: society._id,
          memberId: member._id,
          createdBy: society._id,
          date: startDate,
          type: "Debit",
          category: "Maintenance",
          description: `Bill for ${billPeriod}`,
          amount: bill.currentCharges,
          balanceAfterTransaction: newBalance,
          paymentMode: "System",
          billPeriodId: billPeriod,
          financialYear,
          importRunId,
        });
        // Do NOT zero Member.openingPrincipal/openingInterest here.
        // They are the member's original seed values — zeroing them means if
        // the generated bill is later deleted, the system loses the opening balance forever.
        billsGenerated++;
      } catch (err) {
        console.error(
          `[bulk-import] bill error for ${member.wing}-${member.flatNo}:`,
          err.message,
          err.stack?.split("\n")[1],
        );
        billErrors.push(`${member.wing}-${member.flatNo}: ${err.message}`);
      }
    }
  } else if (validMembers.length === 0) {
    warnings.push("No bills generated — no members were imported.");
  } else if (billingHeads.length === 0) {
    warnings.push("No bills generated — billing heads could not be created.");
  }
  // ── ROLLBACK if bills failed for any member that was expected ────────
  if (billErrors.length > 0) {
    await compensateImportRun(importRunId);
    await markRun(importRunId, {
      status: "ROLLED_BACK",
      errorMessages: billErrors,
      finishedAt: new Date(),
    });
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "bills",
        errors: billErrors,
        warnings,
        rollback: true,
        importRunId,
      },
      { status: 500 },
    );
  }

  // ── COMMIT: society is now safe to expose to normal queries ──────────
  await Society.updateOne({ _id: society._id }, { $set: { importStatus: "active" } });
  await markRun(importRunId, {
    status: "COMMITTED",
    stage: "Queueing onboarding emails",
    processedCount: billsGenerated,
  });

  // ── EMAIL OUTBOX — created only now, after every rollback checkpoint has
  // passed. Durable + idempotent: a retry of this same importRunId can never
  // queue a duplicate email (unique importRunId+userId+type index), and a
  // send failure here cannot undo the DB writes above.
  const outboxDocs = memberCredentials
    .filter((c) => c.isNewUser && c.email)
    .map((cred) => {
      const onboardingToken = signToken({ userId: cred.userId, purpose: "onboarding" }, { expiresIn: "7d" });
      const setCredentialsUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/onboarding/set-credentials?token=${onboardingToken}`;
      return {
        importRunId,
        userId: cred.userId,
        type: "onboarding",
        to: cred.email,
        subject: `Set up your account — ${societyPayload.societyName}`,
        html: onboardingEmailHtml({
          memberName: cred.ownerName,
          societyName: societyPayload.societyName,
          setCredentialsUrl,
        }),
      };
    });
  if (outboxDocs.length > 0) {
    try {
      await EmailOutbox.insertMany(outboxDocs, { ordered: false });
    } catch (err) {
      // Duplicate-key errors here just mean a prior crashed attempt already
      // queued these rows — safe to ignore; anything else is logged.
      if (err.code !== 11000) {
        console.error("[bulk-import] outbox insert error:", err.message);
      }
    }
  }
  await markRun(importRunId, { status: "EMAIL_QUEUED", stage: "Sending onboarding emails" });

  // ── SEND — best-effort, never re-runs a row already marked sent ──────
  const onboardingEmailErrors = [];
  const pending = await EmailOutbox.find({ importRunId, status: "pending" });
  for (const row of pending) {
    try {
      await sendEmail({ to: row.to, subject: row.subject, html: row.html });
      row.status = "sent";
      row.sentAt = new Date();
      await row.save();
    } catch (err) {
      row.attempts += 1;
      row.lastError = err.message;
      row.status = "failed";
      await row.save();
      console.error(`Onboarding email failed for ${row.to}:`, err.message);
      onboardingEmailErrors.push(row.to);
    }
  }

  const result = {
    success: true,
    importRunId,
    society: {
      id: society._id,
      name: society.name,
      societyId: society.societyId,
      societyCode: society.societyCode,
      activeChargesCount: activeCharges.length,
      chargesSummary: activeCharges.map((c) => `${c.label}: ₹${c.value}`),
    },
    admin: {
      name: societyPayload.fullName,
      email: societyPayload.email,
      password: plainPassword,
    },
    membersCreated,
    memberCreateErrors,
    memberCredentials,
    onboardingEmailErrors,
    totalMemberRows: validMembers.length,
    billingHeadsCreated: billingHeads.length,
    billsGenerated,
    billPeriod,
    billErrors,
    warnings,
  };
  await markRun(importRunId, {
    status: "COMPLETED",
    stage: "Done",
    processedCount: validMembers.length,
    result,
    finishedAt: new Date(),
  });
  return NextResponse.json(result);
}