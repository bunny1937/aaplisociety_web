/**
 * POST /api/admin/bulk-import
 * Phase 1: validate everything — return errors without touching DB.
 * Phase 2: create society → admin user → members.
 */

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { calculateMemberCharges } from "@/lib/calculate-member-bill";
import { calculateMonthlyInterest } from "../../../../utils/interestUtils";
import { generateUniqueUsername } from "@/lib/username-generator";
import { randomBytes } from "crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generatePassword() {
  return randomBytes(10).toString("base64url");
}

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

function parseMemberRows(basicInfoRows, parkingByFlat) {
  const members = [];
  const errors = [];
  const seenFlats = new Set();

  for (let i = 0; i < basicInfoRows.length; i++) {
    const row = basicInfoRows[i];
    const flatNo = String(row["flatNo*"] || row["flatNo"] || "").trim();
    const wing = String(row["wing"] || "").trim();

    // Skip instruction / header echo rows
    if (flatNo.toUpperCase().startsWith("INSTRUCTION") || flatNo === "flatNo*")
      continue;
    if (!flatNo || !wing) {
      errors.push({
        label: `Row ${i + 2}`,
        errors: [
          `Missing required field(s): ${!wing ? "'wing'" : ""}${!wing && !flatNo ? ", " : ""}${!flatNo ? "'flatNo*'" : ""}`.trim(),
        ],
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

    members.push({
      flatNo,
      wing,
      ownerName: String(row["ownerName*"] || row["ownerName"] || "").trim(),
      carpetAreaSqft: carpetArea,
      contactNumber: String(
        row["contactNumber*"] || row["contactNumber"] || "",
      ).trim(),
      emailPrimary: emailRaw || null,
      openingPrincipal,
      openingInterest,
      openingBalance: parseFloat(
        (openingPrincipal + openingInterest).toFixed(2),
      ),
      parkingSlots: slots,
      isDeleted: false,
      advanceCredit: 0,
    });
  }

  return { members, errors };
}

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  await connectDB();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file)
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const bytes = await file.arrayBuffer();
  const wb = XLSX.read(Buffer.from(bytes), { cellDates: true });

  if (wb.SheetNames.length < 1) {
    return NextResponse.json(
      {
        error:
          "File must have at least 1 sheet (Society data in Sheet 'Society')",
      },
      { status: 400 },
    );
  }

  // ── PHASE 1: PARSE ────────────────────────────────────────────────

  // Society sheet
  const societySheet = wb.Sheets[wb.SheetNames[0]];
  const societyRows = XLSX.utils.sheet_to_json(societySheet, { defval: "" });
  if (!societyRows.length) {
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "society",
        errors: [
          "Sheet 'Society' has no data rows. Fill in the first row with society details.",
        ],
      },
      { status: 422 },
    );
  }

  const societyPayload = rowToSocietyPayload(societyRows[0]);

  // Member sheet (index 1 = "1. Basic Info (Required)")
  const basicInfoSheetName = wb.SheetNames[1];
  const basicInfoRows = basicInfoSheetName
    ? XLSX.utils.sheet_to_json(wb.Sheets[basicInfoSheetName], { defval: "" })
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
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "society",
        errors: societyErrors,
        warnings,
      },
      { status: 422 },
    );
  }

  // Member validation
  const { members: validMembers, errors: memberErrors } = parseMemberRows(
    basicInfoRows,
    parkingByFlat,
  );

  if (memberErrors.length) {
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "members",
        errors: memberErrors.map((e) => `${e.label}: ${e.errors.join("; ")}`),
        warnings,
        memberRowsTotal: validMembers.length + memberErrors.length,
        memberRowsValid: validMembers.length,
        memberRowsFailed: memberErrors.length,
      },
      { status: 422 },
    );
  }

  if (validMembers.length === 0) {
    const hint =
      basicInfoRows.length > 0
        ? `Sheet has ${basicInfoRows.length} data rows but none could be parsed — check that 'wing' and 'flatNo*' columns are filled and not renamed.`
        : "Sheet '1. Basic Info (Required)' is empty.";
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "members",
        errors: [hint],
        warnings,
      },
      { status: 422 },
    );
  }

  // ── PHASE 3: CREATE ───────────────────────────────────────────────

  let societyId,
    attempts = 0;
  do {
    societyId = generateSocietyId(societyPayload.societyName);
    if (!(await Society.findOne({ societyId }))) break;
  } while (++attempts < 10);

  const plainPassword = generatePassword();
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  let society;
  try {
    society = await Society.create({
      name: societyPayload.societyName,
      societyId,
      registrationNo: societyPayload.registrationNo,
      address: societyPayload.address,
      panNo: societyPayload.panNo,
      tanNo: societyPayload.tanNo,
      config: societyPayload.config,
      credentials: {
        adminEmail: societyPayload.email,
        plainPassword,
      },
      subscription: { status: "Trial", startDate: new Date() },
      isDeleted: false,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create society: ${err.message}` },
      { status: 500 },
    );
  }

  try {
    await User.create({
      name: societyPayload.fullName,
      email: societyPayload.email,
      password: hashedPassword,
      role: "Admin",
      societyId: society._id,
      profiles: [],
      isActive: true,
    });
  } catch (err) {
    await Society.findByIdAndDelete(society._id);
    return NextResponse.json(
      { error: `Failed to create admin user: ${err.message}` },
      { status: 500 },
    );
  }

  let membersCreated = 0;
  const memberCreateErrors = [];
  const memberCredentials = [];
  const createdMemberUserIds = [];
  const appendedProfiles = [];

  for (const memberData of validMembers) {
    try {
      const member = await Member.create({
        ...memberData,
        societyId: society._id,
      });

      if (memberData.emailPrimary) {
        const memberPwd = generatePassword();
        const memberHash = await bcrypt.hash(memberPwd, 10);
        const existingUser = await User.findOne({
          email: memberData.emailPrimary,
        });

        if (existingUser) {
          const profileId = new mongoose.Types.ObjectId();

          existingUser.profiles = existingUser.profiles || [];
          existingUser.profiles.push({
            profileId,
            societyId: society._id,
            memberId: member._id,
            flatNo: memberData.flatNo,
            wing: memberData.wing,
            isPrimary: false,
            status: "Active",
            joinedAt: new Date(),
          });
          await existingUser.save();

          appendedProfiles.push({
            userId: existingUser._id,
            profileId,
          });

          memberCredentials.push({
            flatNo: memberData.flatNo,
            wing: memberData.wing,
            ownerName: memberData.ownerName,
            email: memberData.emailPrimary,
            password: "(existing account — original password unchanged)",
            isNewUser: false,
          });
        } else {
          const username = await generateUniqueUsername(
            societyPayload.societyName,
            memberData.ownerName,
            memberData.flatNo,
          );
          const newUser = await User.create({
            name: memberData.ownerName,
            email: memberData.emailPrimary,
            username,
            phone: memberData.contactNumber || null,
            password: memberHash,
            role: "Member",
            societyId: society._id,
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
          });

          createdMemberUserIds.push(newUser._id);

          memberCredentials.push({
            flatNo: memberData.flatNo,
            wing: memberData.wing,
            ownerName: memberData.ownerName,
            username,
            email: memberData.emailPrimary,
            password: memberPwd,
            isNewUser: true,
          });
        }
      }
      membersCreated++;
    } catch (err) {
      memberCreateErrors.push(
        `${memberData.wing}-${memberData.flatNo}: ${err.message}`,
      );
    }
  }

  // If any member failed to create → rollback and return error
  if (memberCreateErrors.length > 0) {
    try {
      await Member.deleteMany({ societyId: society._id });

      if (createdMemberUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: createdMemberUserIds } });
      }

      for (const { userId, profileId } of appendedProfiles) {
        await User.updateOne(
          { _id: userId },
          { $pull: { profiles: { profileId } } },
        );
      }

      await User.deleteOne({ email: societyPayload.email });
      await Society.findByIdAndDelete(society._id);
    } catch (cleanupErr) {
      console.error("Rollback error:", cleanupErr.message);
    }

    return NextResponse.json(
      {
        validationFailed: true,
        phase: "members",
        errors: memberCreateErrors,
        warnings,
        rollback: true,
        membersAttempted: validMembers.length,
        membersCreated,
      },
      { status: 500 },
    );
  }

  // ── PHASE 4: SYNC BILLING HEADS from config.charges ─────────────
  let billingHeads = [];
  let billingHeadError = null;
  try {
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
      }));

    if (headsToCreate.length > 0) {
      billingHeads = await BillingHead.insertMany(headsToCreate);
    } else {
      warnings.push(
        "No billing heads created — all charge values were 0 in the Society sheet.",
      );
    }
  } catch (err) {
    billingHeadError = err.message;
    warnings.push(`Billing heads sync failed: ${err.message}`);
  }

  // ── PHASE 5: GENERATE CURRENT MONTH BILLS ────────────────────────
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
        const { breakdown, subtotal } = calculateMemberCharges(
          member,
          billingHeads,
        );

        // Opening balances as seeds (no prior bills, so openingPrincipal/openingInterest come from member)
        const prevRemPrincipal = member.openingPrincipal || 0;
        const prevRemInt = member.openingInterest || 0;

        const interestRate = societyPayload.config.interestRate || 21;
        let currInt = 0,
          monthInterest = 0;
        if (prevRemPrincipal > 0 || prevRemInt > 0) {
          ({ currInt, monthInterest } = calculateMonthlyInterest({
            remainingPrincipal: prevRemPrincipal,
            remInt: prevRemInt,
            annualRate: interestRate,
            interestRounding: "TWO_DECIMAL",
          }));
        }

        const _openingPrincipal = parseFloat(prevRemPrincipal.toFixed(2));
        const _openingInterest = parseFloat(prevRemInt.toFixed(2));
        const _currentCharges = parseFloat(subtotal.toFixed(2));
        const _currentInterest = parseFloat((currInt || 0).toFixed(2));
        const _billPrincipalBalance = parseFloat(
          (_openingPrincipal + _currentCharges).toFixed(2),
        );
        const _billInterestBalance = parseFloat(
          (_openingInterest + _currentInterest).toFixed(2),
        );
        const _totalBillDue = parseFloat(
          (_billPrincipalBalance + _billInterestBalance).toFixed(2),
        );
        const _memberAdvance = parseFloat(
          (member.advanceCredit || 0).toFixed(2),
        );
        const _advApplied = parseFloat(
          Math.min(_memberAdvance, _totalBillDue).toFixed(2),
        );
        const _balance = parseFloat(
          Math.max(0, _totalBillDue - _advApplied).toFixed(2),
        );

        if (_advApplied > 0) {
          await Member.findByIdAndUpdate(member._id, {
            $inc: { advanceCredit: -_advApplied },
          });
        }

        const transactionId = Transaction.generateTransactionId();
        const newBalance = (member.openingBalance || 0) + subtotal;

        await Transaction.create({
          transactionId,
          societyId: society._id,
          memberId: member._id,
          createdBy: society._id,
          date: startDate,
          type: "Debit",
          category: "Maintenance",
          description: `Bill for ${billPeriod}`,
          amount: subtotal,
          balanceAfterTransaction: newBalance,
          paymentMode: "System",
          billPeriodId: billPeriod,
          financialYear,
        });

        await Bill.findOneAndUpdate(
          {
            memberId: member._id,
            societyId: society._id,
            billPeriodId: billPeriod,
          },
          {
            $set: {
              billPeriodId: billPeriod,
              billMonth: billMonth - 1, // 0-indexed
              billYear,
              memberId: member._id,
              societyId: society._id,
              openingPrincipal: _openingPrincipal,
              openingInterest: _openingInterest,
              currentCharges: _currentCharges,
              currentInterest: _currentInterest,
              billPrincipalBalance: _billPrincipalBalance,
              billInterestBalance: _billInterestBalance,
              totalBillDue: _totalBillDue,
              previousBalance: member.openingBalance || 0,
              previousPrincipal: _openingPrincipal,
              previousInterest: _openingInterest,
              currInt: currInt || 0,
              monthInterest: monthInterest || 0,
              interestAmount: monthInterest || 0,
              subtotal,
              charges: new Map(
                Object.entries(breakdown).map(([k, v]) => [
                  k,
                  parseFloat(v) || 0,
                ]),
              ),
              totalAmount: _totalBillDue,
              amountPaid: _advApplied,
              advanceApplied: _advApplied,
              principalBalance: parseFloat(
                Math.max(0, _balance - _billInterestBalance).toFixed(2),
              ),
              interestBalance: parseFloat(
                Math.min(_billInterestBalance, _balance).toFixed(2),
              ),
              balanceAmount: _balance,
              dueDate: new Date(
                billYear,
                billMonth - 1,
                societyPayload.config.interestAfterDays || 15,
              ),
              status:
                _balance <= 0.005
                  ? "Paid"
                  : _advApplied > 0
                    ? "Partial"
                    : "Unpaid",
              generatedAt: new Date(),
              importedFrom: "BulkImport",
              isDeleted: false,
            },
          },
          { upsert: true, new: true },
        );

        // Do NOT zero openingPrincipal/openingInterest here.
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
    // At least one bill failed — roll back everything
    try {
      await Bill.deleteMany({ societyId: society._id });
      await Transaction.deleteMany({ societyId: society._id });
      await BillingHead.deleteMany({ societyId: society._id });
      await Member.deleteMany({ societyId: society._id });
      await User.deleteMany({ societyId: society._id });
      await Society.findByIdAndDelete(society._id);
    } catch (cleanupErr) {
      // best-effort cleanup; log but don't mask the real error
      console.error("Rollback error:", cleanupErr.message);
    }
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "bills",
        errors: billErrors,
        warnings,
        rollback: true,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    society: {
      id: society._id,
      name: society.name,
      societyId: society.societyId,
      activeChargesCount: activeCharges.length,
      chargesSummary: activeCharges.map((c) => `${c.label}: ₹${c.value}`),
    },
    admin: {
      email: societyPayload.email,
      password: plainPassword,
    },
    membersCreated,
    memberCreateErrors,
    memberCredentials,
    totalMemberRows: validMembers.length,
    billingHeadsCreated: billingHeads.length,
    billsGenerated,
    billPeriod,
    billErrors,
    warnings,
  });
}
