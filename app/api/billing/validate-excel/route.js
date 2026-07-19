<<<<<<< Updated upstream
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import * as XLSX from "xlsx";
import { calculateMemberCharges } from "../../../../lib/calculate-member-bill";
import { validateBillRows } from "../../../../utils/excelValidator";

// Accepts merged "Wing-FlatNo" (new template) OR separate Wing+FlatNo (legacy)
const REQUIRED_MERGED = ["Wing-FlatNo", "Period"];
const REQUIRED_LEGACY = ["Wing", "FlatNo", "Period"];

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

    // Skip instruction row (Wing-FlatNo or Wing cell starts with ⚠, or all id columns blank)
    const dataRows = rawRows.filter((r) => {
      const wf = String(r["Wing-FlatNo"] || "").trim();
      const w = String(r.Wing || "").trim();
      if (wf.startsWith("⚠") || w.startsWith("⚠")) return false;
      return wf || w || String(r.FlatNo || "").trim();
    });

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
    const wingFlatMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = m;
      const key = `${(m.wing || "").trim().toLowerCase()}-${(m.flatNo || "").trim().toLowerCase()}`;
      wingFlatMap[key] = m;
    });
    const alreadyBilled = new Set(
      existingBills.map((b) => b.memberId?.toString()),
    );

    // Check required columns — accept merged "Wing-FlatNo" (new) or separate Wing+FlatNo (legacy)
    const excelCols = Object.keys(dataRows[0] || {});
    const hasMergedWingFlat = excelCols.includes("Wing-FlatNo");
    const REQUIRED_COLS = hasMergedWingFlat ? REQUIRED_MERGED : REQUIRED_LEGACY;
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

    // Detect upload mode: if ALL data rows resolve to members that already have bills → payment-only upload
    const resolvedMemberIds = dataRows
      .map(r => {
        const wf = String(r["Wing-FlatNo"] || "").trim();
        let key;
        if (wf) {
          const dash = wf.indexOf("-");
          const w = dash > 0 ? wf.slice(0, dash).trim() : wf;
          const f = dash > 0 ? wf.slice(dash + 1).trim() : "";
          key = `${w.toLowerCase()}-${f.toLowerCase()}`;
        } else {
          key = `${String(r.Wing || "").trim().toLowerCase()}-${String(r.FlatNo || "").trim().toLowerCase()}`;
        }
        return wingFlatMap[key]?._id.toString();
      })
      .filter(Boolean);
    const uploadMode = resolvedMemberIds.length > 0 && resolvedMemberIds.every(id => alreadyBilled.has(id))
      ? "PAYMENT_ONLY"
      : "BILL_GENERATE";

    const validBills = [];
    const autoPreviewMap = {};

    // Build auto-preview for comparison (only needed in BILL_GENERATE mode)
    if (uploadMode === "BILL_GENERATE") {
      for (const m of members) {
        const { subtotal } = calculateMemberCharges(m, heads);
        autoPreviewMap[m._id.toString()] = subtotal;
      }
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;

      // Support both merged "Wing-FlatNo" and legacy separate Wing/FlatNo columns
      const wingFlatRaw = String(row["Wing-FlatNo"] || "").trim();
      let wing, flatNo;
      if (wingFlatRaw) {
        const dashIdx = wingFlatRaw.indexOf("-");
        wing = dashIdx > 0 ? wingFlatRaw.slice(0, dashIdx).trim() : wingFlatRaw;
        flatNo = dashIdx > 0 ? wingFlatRaw.slice(dashIdx + 1).trim() : "";
      } else {
        wing = String(row.Wing || "").trim();
        flatNo = String(row.FlatNo || "").trim();
      }
      const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;
      const member = wingFlatMap[flatKey];
      const memberId = member?._id.toString();

      const period = String(row.Period || "").trim();
      const [rowYearStr, rowMonthStr] = period.split("-");
      const rowMonth = parseInt(rowMonthStr);
      const rowYear = parseInt(rowYearStr);
      const excelTotal = parseFloat(row.CurrentCharges ?? row.Total) || 0;

      // Skip instruction row
      if (wing.startsWith("⚠") || wingFlatRaw.startsWith("⚠") || (!wing && !flatNo)) continue;

      // Unknown member
      if (!member) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Flat "${wing}-${flatNo}" not found in system`,
          fix: "Use the Download Template option — do not change Wing or FlatNo.",
        });
        continue;
      }

      // Wrong period
      if (rowMonth !== month || rowYear !== year) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Row period "${period}" doesn't match selected ${year}-${String(month).padStart(2, "0")}`,
          fix: `Re-download the template for the correct period.`,
        });
        continue;
      }

      // Duplicate in Excel
      if (seenMembers.has(memberId)) {
        issues.push({
          row: rowNum,
          type: "duplicate",
          message: `Duplicate entry for ${wing}-${flatNo}`,
          fix: "Remove the duplicate row.",
        });
        continue;
      }
      seenMembers.add(memberId);

      // Already billed — only error in BILL_GENERATE mode
      if (uploadMode === "BILL_GENERATE" && alreadyBilled.has(memberId)) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Bills for ${wing}-${flatNo} already exist for ${month}/${year}`,
          fix: "Delete existing bills from View Bills before re-generating, or just fill AmountPaid to record payments.",
        });
        continue;
      }

      // Negative total
      if (excelTotal < 0) {
        issues.push({
          row: rowNum,
          type: "warning",
          message: `Total is negative (${excelTotal}) for ${wing}-${flatNo}`,
          fix: "Check if charge amounts are correct. Negative total is unusual.",
        });
      }

      // Zero total warning
      if (excelTotal === 0) {
        issues.push({
          row: rowNum,
          type: "warning",
          message: `Total is ₹0 for ${wing}-${flatNo}`,
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

      // Read reference columns from unified template (read-only — generate route overwrites with live DB)
      const excelCurrentInterest = parseFloat(row["CurrentInterest"]) || 0;
      const excelOpeningPrincipal = parseFloat(row["OpeningPrincipal"]) || 0;
      const excelOpeningInterest = parseFloat(row["OpeningInterest"]) || 0;

      validBills.push({
        memberId,
        charges,
        subtotal: excelTotal,
        grandTotal: excelTotal,
        interestAmount: excelCurrentInterest,
        previousBalance: excelOpeningPrincipal + excelOpeningInterest,
        unpaidBills: [],
        recentTransactions: [],
      });
    }

    // Build comparison with auto-calculated
    const comparison = validBills.map((b) => {
      const m = memberMap[b.memberId];
      const autoTotal = autoPreviewMap[b.memberId] || 0;
      return {
        memberId: b.memberId,
        flat: `${m.wing}-${m.flatNo}`,
        name: m.ownerName,
        excelTotal: b.subtotal,
        autoTotal,
        hasDiff: uploadMode === "PAYMENT_ONLY" ? false : Math.abs(b.subtotal - autoTotal) > 0.5,
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
    const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
    const { gridRows, summary: gridSummary } = validateBillRows(dataRows, {
      wingFlatMap,
      billPeriodId,
      expectedColumns: hasMergedWingFlat ? ["Wing-FlatNo", "Period"] : ["Wing", "FlatNo", "Period"],
    });
    const gridColumns = Object.keys(dataRows[0] || {});

    // Detect if any row has AmountPaid filled — unified template dual-mode detection
    const hasPaymentData = dataRows.some(r => String(r.AmountPaid ?? "").trim() !== "");

    return NextResponse.json({
      success: true,
      hasPaymentData,
      uploadMode,
      canProceed: uploadMode === "PAYMENT_ONLY" ? errorCount === 0 : canProceed,
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
      comparison: uploadMode === "PAYMENT_ONLY" ? [] : comparison,
      gridRows,
      gridColumns,
      gridSummary,
    });
  } catch (err) {
    console.error("validate-excel error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
=======
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import * as XLSX from "xlsx";
import { calculateMemberCharges } from "../../../../lib/calculate-member-bill";
import { validateBillRows } from "../../../../utils/excelValidator";

// Accepts merged "Wing-FlatNo" (new template) OR separate Wing+FlatNo (legacy)
const REQUIRED_MERGED = ["Wing-FlatNo", "Period"];
const REQUIRED_LEGACY = ["Wing", "FlatNo", "Period"];

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

    // Skip instruction row (Wing-FlatNo or Wing cell starts with ⚠, or all id columns blank)
    const dataRows = rawRows.filter((r) => {
      const wf = String(r["Wing-FlatNo"] || "").trim();
      const w = String(r.Wing || "").trim();
      if (wf.startsWith("⚠") || w.startsWith("⚠")) return false;
      return wf || w || String(r.FlatNo || "").trim();
    });

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
    const wingFlatMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = m;
      const key = `${(m.wing || "").trim().toLowerCase()}-${(m.flatNo || "").trim().toLowerCase()}`;
      wingFlatMap[key] = m;
    });
    const alreadyBilled = new Set(
      existingBills.map((b) => b.memberId?.toString()),
    );

    // Check required columns — accept merged "Wing-FlatNo" (new) or separate Wing+FlatNo (legacy)
    const excelCols = Object.keys(dataRows[0] || {});
    const hasMergedWingFlat = excelCols.includes("Wing-FlatNo");
    const REQUIRED_COLS = hasMergedWingFlat ? REQUIRED_MERGED : REQUIRED_LEGACY;
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

    // Detect upload mode: if ALL data rows resolve to members that already have bills → payment-only upload
    const resolvedMemberIds = dataRows
      .map(r => {
        const wf = String(r["Wing-FlatNo"] || "").trim();
        let key;
        if (wf) {
          const dash = wf.indexOf("-");
          const w = dash > 0 ? wf.slice(0, dash).trim() : wf;
          const f = dash > 0 ? wf.slice(dash + 1).trim() : "";
          key = `${w.toLowerCase()}-${f.toLowerCase()}`;
        } else {
          key = `${String(r.Wing || "").trim().toLowerCase()}-${String(r.FlatNo || "").trim().toLowerCase()}`;
        }
        return wingFlatMap[key]?._id.toString();
      })
      .filter(Boolean);
    const uploadMode = resolvedMemberIds.length > 0 && resolvedMemberIds.every(id => alreadyBilled.has(id))
      ? "PAYMENT_ONLY"
      : "BILL_GENERATE";

    const validBills = [];
    const autoPreviewMap = {};

    // Build auto-preview for comparison (only needed in BILL_GENERATE mode)
    if (uploadMode === "BILL_GENERATE") {
      for (const m of members) {
        const { subtotal } = calculateMemberCharges(m, heads);
        autoPreviewMap[m._id.toString()] = subtotal;
      }
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;

      // Support both merged "Wing-FlatNo" and legacy separate Wing/FlatNo columns
      const wingFlatRaw = String(row["Wing-FlatNo"] || "").trim();
      let wing, flatNo;
      if (wingFlatRaw) {
        const dashIdx = wingFlatRaw.indexOf("-");
        wing = dashIdx > 0 ? wingFlatRaw.slice(0, dashIdx).trim() : wingFlatRaw;
        flatNo = dashIdx > 0 ? wingFlatRaw.slice(dashIdx + 1).trim() : "";
      } else {
        wing = String(row.Wing || "").trim();
        flatNo = String(row.FlatNo || "").trim();
      }
      const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;
      const member = wingFlatMap[flatKey];
      const memberId = member?._id.toString();

      const period = String(row.Period || "").trim();
      const [rowYearStr, rowMonthStr] = period.split("-");
      const rowMonth = parseInt(rowMonthStr);
      const rowYear = parseInt(rowYearStr);
      const excelTotal = parseFloat(row.CurrentCharges ?? row.Total) || 0;

      // Skip instruction row
      if (wing.startsWith("⚠") || wingFlatRaw.startsWith("⚠") || (!wing && !flatNo)) continue;

      // Unknown member
      if (!member) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Flat "${wing}-${flatNo}" not found in system`,
          fix: "Use the Download Template option — do not change Wing or FlatNo.",
        });
        continue;
      }

      // Wrong period
      if (rowMonth !== month || rowYear !== year) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Row period "${period}" doesn't match selected ${year}-${String(month).padStart(2, "0")}`,
          fix: `Re-download the template for the correct period.`,
        });
        continue;
      }

      // Duplicate in Excel
      if (seenMembers.has(memberId)) {
        issues.push({
          row: rowNum,
          type: "duplicate",
          message: `Duplicate entry for ${wing}-${flatNo}`,
          fix: "Remove the duplicate row.",
        });
        continue;
      }
      seenMembers.add(memberId);

      // Already billed — only error in BILL_GENERATE mode
      if (uploadMode === "BILL_GENERATE" && alreadyBilled.has(memberId)) {
        issues.push({
          row: rowNum,
          type: "error",
          message: `Bills for ${wing}-${flatNo} already exist for ${month}/${year}`,
          fix: "Delete existing bills from View Bills before re-generating, or just fill AmountPaid to record payments.",
        });
        continue;
      }

      // Negative total
      if (excelTotal < 0) {
        issues.push({
          row: rowNum,
          type: "warning",
          message: `Total is negative (${excelTotal}) for ${wing}-${flatNo}`,
          fix: "Check if charge amounts are correct. Negative total is unusual.",
        });
      }

      // Zero total warning
      if (excelTotal === 0) {
        issues.push({
          row: rowNum,
          type: "warning",
          message: `Total is ₹0 for ${wing}-${flatNo}`,
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

      // Read reference columns from unified template (read-only — generate route overwrites with live DB)
      const excelCurrentInterest = parseFloat(row["CurrentInterest"]) || 0;
      const excelOpeningPrincipal = parseFloat(row["OpeningPrincipal"]) || 0;
      const excelOpeningInterest = parseFloat(row["OpeningInterest"]) || 0;

      validBills.push({
        memberId,
        charges,
        subtotal: excelTotal,
        grandTotal: excelTotal,
        interestAmount: excelCurrentInterest,
        previousBalance: excelOpeningPrincipal + excelOpeningInterest,
        unpaidBills: [],
        recentTransactions: [],
      });
    }

    // Build comparison with auto-calculated
    const comparison = validBills.map((b) => {
      const m = memberMap[b.memberId];
      const autoTotal = autoPreviewMap[b.memberId] || 0;
      return {
        memberId: b.memberId,
        flat: `${m.wing}-${m.flatNo}`,
        name: m.ownerName,
        excelTotal: b.subtotal,
        autoTotal,
        hasDiff: uploadMode === "PAYMENT_ONLY" ? false : Math.abs(b.subtotal - autoTotal) > 0.5,
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
    const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
    const { gridRows, summary: gridSummary } = validateBillRows(dataRows, {
      wingFlatMap,
      billPeriodId,
      expectedColumns: hasMergedWingFlat ? ["Wing-FlatNo", "Period"] : ["Wing", "FlatNo", "Period"],
    });
    const gridColumns = Object.keys(dataRows[0] || {});

    // Detect if any row has AmountPaid filled — unified template dual-mode detection
    const hasPaymentData = dataRows.some(r => String(r.AmountPaid ?? "").trim() !== "");

    return NextResponse.json({
      success: true,
      hasPaymentData,
      uploadMode,
      canProceed: uploadMode === "PAYMENT_ONLY" ? errorCount === 0 : canProceed,
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
      comparison: uploadMode === "PAYMENT_ONLY" ? [] : comparison,
      gridRows,
      gridColumns,
      gridSummary,
    });
  } catch (err) {
    console.error("validate-excel error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
>>>>>>> Stashed changes
