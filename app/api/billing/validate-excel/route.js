import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import * as XLSX from "xlsx";
import { calculateMemberCharges } from "../../../../lib/calculate-member-bill";
import { validateBillRows } from "../../../../utils/excelValidator";

const REQUIRED_COLS = [
  "MemberId",
  "Wing",
  "FlatNo",
  "OwnerName",
  "Month",
  "Year",
  "DueDate",
  "Total",
];

export async function POST(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file");
    const month = parseInt(formData.get("month"));
    const year = parseInt(formData.get("year"));
    const dueDate = formData.get("dueDate");

    if (!file)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024)
      return NextResponse.json(
        { error: "File too large. Max 5MB." },
        { status: 400 },
      );

    const bytes = await file.arrayBuffer();
    const wb = XLSX.read(Buffer.from(bytes), { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    // Skip instruction row if present
    const dataRows = rawRows.filter(
      (r) => !String(r.MemberId || "").startsWith("⚠"),
    );

    const issues = [];
    const seenMembers = new Set();

    // Fetch all valid members + billing heads for this society
    const [members, heads, existingBills] = await Promise.all([
      Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
        .select(
          "_id flatNo wing ownerName carpetAreaSqft builtUpAreaSqft parkingSlots",
        )
        .lean(),
      BillingHead.find({
        societyId: decoded.societyId,
        isActive: true,
        isDeleted: false,
      })
        .sort({ order: 1 })
        .lean(),
      Bill.find({
        societyId: decoded.societyId,
        billYear: year,
        billMonth: month - 1,
      })
        .select("memberId")
        .lean(),
    ]);

    const memberMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = m;
    });
    const alreadyBilled = new Set(
      existingBills.map((b) => b.memberId?.toString()),
    );

    // Check required columns
    const excelCols = Object.keys(dataRows[0] || {});
    for (const col of REQUIRED_COLS) {
      if (!excelCols.includes(col)) {
        issues.push({
          row: null,
          type: "error",
          message: `Missing required column: "${col}"`,
          fix: `Add a column named exactly "${col}" to your Excel file.`,
        });
      }
    }
    if (issues.filter((i) => i.type === "error").length > 0) {
      return NextResponse.json({
        canProceed: false,
        errorCount: issues.length,
        warningCount: 0,
        duplicateCount: 0,
        issues,
      });
    }

    const validBills = [];
    const autoPreviewMap = {};

    // Build auto-preview for comparison
    for (const m of members) {
      const { subtotal } = calculateMemberCharges(m, heads);
      autoPreviewMap[m._id.toString()] = subtotal;
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // 1 for header + 1-indexed

      const memberId = String(row.MemberId || "").trim();
      const rowMonth = parseInt(row.Month);
      const rowYear = parseInt(row.Year);
      const excelTotal = parseFloat(row.Total) || 0;

      // Unknown member
      if (!memberId || !memberMap[memberId]) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `MemberId "${memberId}" not found in system`,
          fix: "Use the Download Template option to get correct MemberIds, or fix the ID to match an existing member.",
        });
        continue;
      }

      // Wrong month/year
      if (rowMonth !== month || rowYear !== year) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Row has Month=${rowMonth}, Year=${rowYear} but generating for ${month}/${year}`,
          fix: `Change Month to ${month} and Year to ${year} in this row.`,
        });
        continue;
      }

      // Duplicate in Excel
      if (seenMembers.has(memberId)) {
        issues.push({
          row: rowNum,
          type: "duplicate",
          message: `Duplicate entry for MemberId "${memberId}" (${row.Wing}-${row.FlatNo})`,
          fix: "Remove the duplicate row. Each member should appear only once.",
        });
        continue;
      }
      seenMembers.add(memberId);

      // Already billed in DB
      if (alreadyBilled.has(memberId)) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Bills for ${row.Wing}-${row.FlatNo} already exist for ${month}/${year}`,
          fix: "Delete existing bills for this period from View Bills before re-generating.",
        });
        continue;
      }

      // Negative total
      if (excelTotal < 0) {
        issues.push({
          row: rowNum,
          type: "warning",
          message: `Total is negative (${excelTotal}) for ${row.Wing}-${row.FlatNo}`,
          fix: "Check if charge amounts are correct. Negative total is unusual.",
        });
      }

      // Zero total warning
      if (excelTotal === 0) {
        issues.push({
          row: rowNum,
          type: "warning",
          message: `Total is ₹0 for ${row.Wing}-${row.FlatNo}`,
          fix: "Verify if this member truly has zero charges this month, or check charge columns.",
        });
      }

      // Build charges map from head columns
      const charges = {};
      for (const h of heads) {
        if (row[h.headName] !== "" && row[h.headName] !== undefined) {
          charges[h.headName] = parseFloat(row[h.headName]) || 0;
        }
      }

      // Read PreviousBalance and InterestDue from Excel columns if present
      const excelPrevBalance = parseFloat(row["PreviousBalance"]) || 0;
      const excelInterestDue = parseFloat(row["InterestDue"]) || 0;

      // CHANGE TO:
      const excelGrandTotal =
        parseFloat(row["GrandTotal"]) ||
        excelTotal + excelPrevBalance + excelInterestDue;
      validBills.push({
        memberId,
        charges,
        grandTotal: excelTotal, // current charges only — generate route overwrites with live total
        subtotal: excelTotal, // current charges only
        interestAmount: excelInterestDue,
        previousBalance: excelPrevBalance, // used only for display — generate route overwrites with live DB
        unpaidBills: [],
        recentTransactions: [],
      });
    }

    // Build comparison with auto-calculated
    const comparison = validBills.map((b) => {
      const m = memberMap[b.memberId];
      const autoTotal = autoPreviewMap[b.memberId] || 0;
      // CHANGE TO:
      return {
        memberId: b.memberId,
        flat: `${m.wing}-${m.flatNo}`,
        name: m.ownerName,
        excelTotal: b.subtotal,
        autoTotal,
        hasDiff: Math.abs(b.subtotal - autoTotal) > 0.5,
      };
    });

    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const duplicateCount = issues.filter((i) => i.type === "duplicate").length;

    const diffCount = comparison.filter((r) => r.hasDiff).length;
    // Add memberId to diff issues for approve-per-diff UX
    // CHANGE TO:
    const diffIssues = comparison
      .filter((r) => r.hasDiff)
      .map((r) => ({
        type: "diff",
        memberId: r.memberId, // ← also add memberId to the return in comparison map above:
        flat: r.flat,
        name: r.name,
        excelTotal: r.excelTotal,
        autoTotal: r.autoTotal,
        diff: parseFloat((r.excelTotal - r.autoTotal).toFixed(2)),
        why: "Excel subtotal differs from system auto-calculation",
        fix: "Verify charges in your Excel match the billing head rates, or approve if intentional override",
      }));
    const errors = issues.filter((i) => i.type === "error");
    const warnings = issues.filter((i) => i.type === "warning");
    const canProceed = errorCount === 0 && warningCount === 0;

    // Build per-cell grid for ExcelPreviewGrid
    const validMemberIdSet = new Set(members.map((m) => m._id.toString()));
    const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
    const { gridRows, summary: gridSummary } = validateBillRows(dataRows, {
      validMemberIds: validMemberIdSet,
      billPeriodId,
      expectedColumns: ["MemberId", "Month", "Year"],
    });
    const gridColumns = Object.keys(dataRows[0] || {});

    return NextResponse.json({
      success: true,

      canProceed,
      blockReason: !canProceed
        ? `${errorCount} error(s) and ${warningCount} warning(s) must be resolved before generating.`
        : null,
      validCount: validBills.length,
      errors: errors.map((e) => ({
        row: e.row,
        message: e.message,
        fix: e.fix,
      })),
      errorCount,
      warnings: warnings.map((w) => ({
        row: w.row,
        message: w.message,
        fix: w.fix,
      })),
      warningCount,
      duplicateCount,
      diffCount,
      issues: [...issues, ...diffIssues],
      bills: validBills,
      comparison,
      gridRows,
      gridColumns,
      gridSummary,
    });
  } catch (err) {
    console.error("validate-excel error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
