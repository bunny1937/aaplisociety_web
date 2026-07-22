import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import BillingHead from "@/models/BillingHead";
import * as XLSX from "xlsx";
import { v4 as uuidv4 } from "uuid";
import { requireRoles, BILLING_WRITE_ROLES } from "@/lib/authz";
import { calculateMonthlyInterest } from "@/utils/interestUtils";
import { resolveOpeningBalances } from "@/lib/billing/generationService";
import { validateBillInvariants } from "@/lib/billing/invariants";

const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));
let tempStorage = {};
export async function POST(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, BILLING_WRITE_ROLES);
    if (!auth.valid) return auth;
    const decoded = auth.user;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    // STEP 1: PREVIEW
    if (action === "preview") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) {
        return NextResponse.json(
          { error: "No file uploaded" },
          { status: 400 },
        );
      }
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      // Read Excel
      const workbook = XLSX.read(buffer);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(worksheet);
      if (data.length === 0) {
        return NextResponse.json(
          { error: "Excel file is empty" },
          { status: 400 },
        );
      }
      // Get headers
      const headers = Object.keys(data[0]);
      // Required columns
      const required = ["Member ID", "Bill Month", "Bill Year"];
      const missing = required.filter((r) => !headers.includes(r));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Missing required columns: ${missing.join(", ")}`,
          },
          { status: 400 },
        );
      }
      // Fetch members
      const members = await Member.find({
        societyId: decoded.societyId,
      }).lean();
      const memberMap = new Map(members.map((m) => [m._id.toString(), m]));
      // Fetch existing bills
      const existingBills = await Bill.find({ societyId: decoded.societyId })
        .select("memberId billMonth billYear billPeriodId")
        .lean();
      const existingSet = new Set(
        existingBills.map((b) => `${b.memberId}-${b.billMonth}-${b.billYear}`),
      );
      // Validate rows
      const rows = [];
      let valid = 0,
        warnings = 0,
        errors = 0,
        duplicates = 0;
      const duplicateList = [];
      const errorList = [];
      data.forEach((row, index) => {
        const issues = [];
        let status = "Valid";
        const rowNumber = index + 2; // Excel row number
        // Validate Member ID
        const memberId = row["Member ID"]?.toString().trim();
        if (!memberId) {
          issues.push("Member ID missing");
          status = "Error";
        } else if (!memberMap.has(memberId)) {
          issues.push("Member ID not found");
          status = "Error";
        }
        // Validate Month & Year
        const billMonth = parseInt(row["Bill Month"]);
        const billYear = parseInt(row["Bill Year"]);
        if (isNaN(billMonth) || billMonth < 0 || billMonth > 11) {
          issues.push("Invalid Bill Month (0-11)");
          status = "Error";
        }
        if (isNaN(billYear) || billYear < 2000 || billYear > 2100) {
          issues.push("Invalid Bill Year");
          status = "Error";
        }
        // Check duplicates
        const billKey = `${memberId}-${billMonth}-${billYear}`;
        if (existingSet.has(billKey)) {
          issues.push("Duplicate bill exists");
          status = "Error";
          duplicates++;
          const member = memberMap.get(memberId);
          duplicateList.push({
            member: member ? `${member.wing}-${member.roomNo}` : "Unknown",
            period: `${billYear}-${String(billMonth + 1).padStart(2, "0")}`,
            rowNumber,
          });
        }
        // Validate amounts (all charge columns)
        const chargeColumns = headers.filter(
          (h) =>
            ![
              "Member ID",
              "Wing",
              "Room No",
              "Bill Month",
              "Bill Year",
              "Due Date",
              "Notes",
            ].includes(h),
        );
        const charges = {};
        chargeColumns.forEach((col) => {
          const value = parseFloat(row[col]);
          if (!isNaN(value) && value > 0) {
            charges[col] = value;
          }
        });
        const totalAmount = Object.values(charges).reduce(
          (sum, val) => sum + val,
          0,
        );
        if (totalAmount === 0) {
          issues.push("Total amount is 0");
          status = "Warning";
          warnings++;
        }
        if (status === "Error") {
          errors++;
          errorList.push({ rowNumber, message: issues.join(", ") });
        } else if (status === "Valid") {
          valid++;
        }
        const member = memberMap.get(memberId);
        rows.push({
          rowNumber,
          status,
          member: member ? `${member.wing}-${member.roomNo}` : "Unknown",
          period: `${billYear}-${String(billMonth + 1).padStart(2, "0")}`,
          amount: totalAmount.toFixed(2),
          issues,
          data: row,
        });
      });
      // Store in temp cache — only keep what confirm step needs, not the full token
      const batchId = uuidv4();
      tempStorage[batchId] = {
        rows,
        societyId: decoded.societyId,
        userId: decoded.userId,
      };
      return NextResponse.json({
        batchId,
        total: rows.length,
        valid,
        warnings,
        errors,
        duplicates,
        duplicateList: duplicateList.slice(0, 50),
        errorList: errorList.slice(0, 50),
        rows,
      });
    }
    // STEP 2: CONFIRM
    if (action === "confirm") {
      const { batchId } = await request.json();
      const cached = tempStorage[batchId];
      if (!cached) {
        return NextResponse.json({ error: "Session expired" }, { status: 400 });
      }
      const { rows, societyId: cachedSocietyId, userId: cachedUserId } = cached;
      const validRows = rows.filter((r) => r.status === "Valid");
      // Fetch members again
      const members = await Member.find({
        societyId: cachedSocietyId,
      }).lean();
      const memberMap = new Map(members.map((m) => [m._id.toString(), m]));
      const society = await Society.findById(cachedSocietyId).lean();
      const interestRate = society?.config?.interestRate || 0;
      const interestRounding = society?.config?.interestRounding || "TWO_DECIMAL";

      // Ledger V2: admin-specified custom charge columns bypass BillingHeads
      // (that's the point of this importer), so it can't call generateBill()
      // directly — but opening-balance carry-forward and interest still use
      // the SAME canonical formula/invariants as every other generation path.
      const billsToInsert = [];
      const errors = [];
      for (const row of validRows) {
        try {
          const data = row.data;
          const memberId = data["Member ID"].toString().trim();
          const member = memberMap.get(memberId);
          if (!member) throw new Error("Member not found");
          const billMonth = parseInt(data["Bill Month"]);
          const billYear = parseInt(data["Bill Year"]);
          const billPeriodId = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;

          const chargesMap = new Map();
          Object.keys(data).forEach((key) => {
            if (
              ![
                "Member ID", "Wing", "Room No", "Bill Month", "Bill Year",
                "Due Date", "Notes", "Total Amount",
              ].includes(key)
            ) {
              const value = parseFloat(data[key]);
              if (!isNaN(value) && value > 0) chargesMap.set(key, value);
            }
          });
          const currentCharges = twoDp(
            Array.from(chargesMap.values()).reduce((sum, v) => sum + v, 0),
          );

          const { openingPrincipal, openingInterest } = await resolveOpeningBalances({
            memberId,
            societyId: cachedSocietyId,
            year: billYear,
            month: billMonth + 1,
            member,
          });

          let currentInterest = 0;
          if (openingPrincipal > 0) {
            const { currInt } = calculateMonthlyInterest({
              remainingPrincipal: openingPrincipal,
              remInt: 0,
              annualRate: interestRate,
              interestRounding,
            });
            currentInterest = twoDp(currInt);
          }

          const billPrincipalBalance = twoDp(openingPrincipal + currentCharges);
          const billInterestBalance = twoDp(openingInterest + currentInterest);
          const totalBillDue = twoDp(billPrincipalBalance + billInterestBalance);
          // No-payment-yet default (§1/§3): closing = opening + current.
          const closingPrincipal = billPrincipalBalance;
          const closingInterest = billInterestBalance;
          const balanceAmount = twoDp(closingPrincipal + closingInterest);

          const chargesObj = Object.fromEntries(chargesMap);
          validateBillInvariants({
            openingPrincipal, openingInterest, currentCharges, currentInterest,
            totalBillDue, closingPrincipal, closingInterest, balanceAmount,
            charges: chargesObj,
          });

          const dueDate = data["Due Date"]
            ? new Date(data["Due Date"])
            : new Date(billYear, billMonth, 10);

          billsToInsert.push({
            billPeriodId,
            billMonth,
            billYear,
            memberId,
            societyId: cachedSocietyId,
            charges: chargesObj,
            openingPrincipal,
            openingInterest,
            currentCharges,
            currentInterest,
            interestRateApplied: interestRate,
            billPrincipalBalance,
            billInterestBalance,
            totalBillDue,
            closingPrincipal,
            closingInterest,
            closingTotal: balanceAmount,
            totalAmount: totalBillDue,
            balanceAmount,
            amountPaid: 0,
            dueDate,
            status: "Unpaid",
            importedFrom: "Excel",
            notes: data["Notes"] || "",
            generatedBy: cachedUserId,
            generatedAt: new Date(),
            schemaVersion: 2,
            calculationVersion: 1,
            engineVersion: "Ledger V2",
          });
        } catch (err) {
          errors.push({ rowNumber: row.rowNumber, error: err.message });
        }
      }
      if (billsToInsert.length > 0) await Bill.insertMany(billsToInsert);
      // Clear cache
      delete tempStorage[batchId];
      return NextResponse.json({
        success: true,
        imported: billsToInsert.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `${billsToInsert.length} bill(s) imported successfully`,
      });
    }
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Import bills error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
