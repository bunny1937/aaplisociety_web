import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import AuditReport from "@/models/AuditReport";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { buildWorkbook, addSheetFromJson, workbookBuffer } from "@/lib/excelParse";
// GET /api/superadmin/audit-reports
// Query: ?societyId=xxx  → return full report with billRows
//        (no query)      → list all reports summary
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const societyId = searchParams.get("societyId");
    const download = searchParams.get("download") === "true";
    if (societyId) {
      const report = await AuditReport.findOne({ societyId }).lean();
      if (!report)
        return NextResponse.json(
          { error: "Report not found" },
          { status: 404 },
        );
      if (download) {
        // Export as Excel
        const wb = buildWorkbook();
        // Summary sheet
        const summaryData = [
          {
            Society: report.societyName,
            "Join Month/Year": `${report.joinMonth}/${report.joinYear}`,
            "Audit From": `${report.auditFromMonth}/${report.auditFromYear}`,
            "Audit To": `${report.auditToMonth}/${report.auditToYear}`,
            "Total Months": report.totalMonthsRequired,
            Status: report.status,
            "Submitted At": new Date(report.submittedAt).toLocaleDateString(
              "en-IN",
            ),
            "Total Rows": report.validation?.totalRowsFound,
            "Members Found": report.validation?.totalMembersFound,
            Passed: report.validation?.passed ? "YES" : "NO",
          },
        ];
        addSheetFromJson(wb, "Summary", summaryData);
        // Bill rows sheet
        if (report.billRows?.length) {
          const rowsFlat = report.billRows.map((r) => ({
            MemberId: r.memberId,
            Wing: r.wing,
            FlatNo: r.flatNo,
            OwnerName: r.ownerName,
            Month: r.month,
            Year: r.year,
            Period: r.billPeriodId,
            PreviousBalance: r.previousBalance,
            InterestDue: r.interestDue,
            ...r.charges,
            Subtotal: r.subtotal,
            GrandTotal: r.grandTotal,
          }));
          addSheetFromJson(wb, "BillData", rowsFlat);
        }
        const buf = await workbookBuffer(wb);
        return new NextResponse(buf, {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename=AuditReport-${report.societyName}-${report.societyId}.xlsx`,
          },
        });
      }
      return NextResponse.json({ success: true, report });
    }
    // List all
    const reports = await AuditReport.find()
      .select("-billRows")
      .sort({ submittedAt: -1 })
      .lean();
    return NextResponse.json({ success: true, reports, total: reports.length });
  } catch (err) {
    console.error("superadmin audit-reports GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
// PUT /api/superadmin/audit-reports — update status (Approved/Rejected)
export async function PUT(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { reportId, status, reviewNotes } = await request.json();
    if (!["Approved", "Rejected"].includes(status))
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const report = await AuditReport.findByIdAndUpdate(
      reportId,
      {
        status,
        reviewNotes,
        reviewedAt: new Date(),
        reviewedBy: validation.admin.userId,
      },
      { new: true },
    )
      .select("-billRows")
      .lean();
    if (!report)
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json({ success: true, report });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
