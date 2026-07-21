import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { validateAdminRequest } from "@/lib/admin-middleware";
const HEADERS = [
  "Wing-FlatNo", "Period",
  "CurrentCharges", "OpeningPrincipal", "OpeningInterest",
  "CurrentInterest", "BillPrincipal", "BillInterest",
  "TotalBillDue", "AlreadyPaid", "AdvanceCredit", "RemainingDue",
  "AmountPaid", "PaymentMethod", "PaymentDate", "Remarks",
  "Maintenance Charges", "Sinking Fund", "Repair Fund",
  "Water Charges", "Security Charges", "Electricity Charges",
  "Open Parking - Two Wheeler", "Open Parking - Four Wheeler",
  "Covered Parking - Two Wheeler", "Covered Parking - Four Wheeler",
];
// Generate months from prevApril to one month before joinMonth (inclusive)
function getHistoryMonths(joinPeriodId) {
  // joinPeriodId = "YYYY-MM" (1-indexed) e.g. "2026-05"
  // Rule: always start April of (joinYear - 1), end month before join
  // May 2026 → Apr 2025 … Apr 2026 (13 months)
  // Jun 2024 → Apr 2023 … May 2024 (14 months)
  // Feb 2027 → Apr 2026 … Jan 2027 (10 months)
  const [joinYear, joinMonthStr] = joinPeriodId.split("-").map(Number);
  const joinMonth0 = joinMonthStr - 1; // 0-indexed
  const months = [];
  let y = joinYear - 1;
  let m0 = 3; // April
  while (true) {
    if (y === joinYear && m0 === joinMonth0) break;
    if (y > joinYear) break;
    months.push({ year: y, month0: m0 });
    m0++;
    if (m0 > 11) { m0 = 0; y++; }
  }
  return months;
}
function periodIdFromYM(year, month0) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}
export async function GET(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;
  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  const joinPeriodId = searchParams.get("joinPeriod"); // e.g. "2026-05"
  if (!societyId || !joinPeriodId) {
    return NextResponse.json({ error: "societyId and joinPeriod required" }, { status: 400 });
  }
  await connectDB();
  const sid = new mongoose.Types.ObjectId(societyId);
  const members = await Member.find({ societyId: sid, isDeleted: { $ne: true } })
    .select("flatNo wing")
    .sort({ wing: 1, flatNo: 1 })
    .lean();
  if (!members.length) {
    return NextResponse.json({ error: "No members found for this society" }, { status: 400 });
  }
  const months = getHistoryMonths(joinPeriodId);
  if (!months.length) {
    return NextResponse.json({ error: "No history months to generate (society joined in April?)" }, { status: 400 });
  }
  const wb = XLSX.utils.book_new();
  // Instructions sheet
  const instrData = [
    ["BILL HISTORY IMPORT TEMPLATE"],
    [""],
    ["Instructions:"],
    ["1. Each sheet = one billing month (earliest first, ascending order)"],
    ["2. Fill ALL rows for ALL members for EACH month"],
    ["3. Period column: use the format shown (YYYY-MM)"],
    ["4. OpeningPrincipal / OpeningInterest on Sheet1 = seed balances from previous records"],
    ["5. For subsequent sheets, Opening = previous month's closing balance after payment"],
    ["6. PaymentMethod: Cash / Cheque / Online / NEFT / UPI"],
    ["7. Leave AmountPaid = 0 if member didn't pay that month"],
    ["8. DO NOT change column headers or sheet names"],
    [""],
    ["Months to fill:"],
    ...months.map((m, i) => [`Sheet ${i + 2}: ${periodIdFromYM(m.year, m.month0)}`]),
    [""],
    ["Members (Wing-FlatNo):"],
    ...members.map((m) => [`${m.wing ? m.wing + "-" : ""}${m.flatNo}`]),
  ];
  const instrWs = XLSX.utils.aoa_to_sheet(instrData);
  instrWs["!cols"] = [{ wch: 40 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, instrWs, "Instructions");
  // One sheet per month
  for (const { year, month0 } of months) {
    const pid = periodIdFromYM(year, month0);
    const dataRows = [HEADERS];
    for (const m of members) {
      const wingFlat = m.wing ? `${m.wing}-${m.flatNo}` : m.flatNo;
      const row = [
        wingFlat, pid,
        0, 0, 0,  // CurrentCharges, OpeningPrincipal, OpeningInterest
        0, 0, 0,  // CurrentInterest, BillPrincipal, BillInterest
        0, 0, 0, 0, // TotalBillDue, AlreadyPaid, AdvanceCredit, RemainingDue
        0, "Cash", "", "", // AmountPaid, PaymentMethod, PaymentDate, Remarks
        0, 0, 0, 0, 0, 0, // charge heads
        0, 0, 0, 0,
      ];
      dataRows.push(row);
    }
    const ws = XLSX.utils.aoa_to_sheet(dataRows);
    ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    // Bold header row
    HEADERS.forEach((_, ci) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (ws[ref]) ws[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: "D6E4FF" } } };
    });
    XLSX.utils.book_append_sheet(wb, ws, pid);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="BillHistory_Template_${societyId}_${joinPeriodId}.xlsx"`,
    },
  });
}
