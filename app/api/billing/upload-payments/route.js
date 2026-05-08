import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Receipt from "@/models/Receipt";
import Society from "@/models/Society";
import PaymentImport from "@/models/PaymentImport";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { allocatePaymentInterestFirst } from "../../../../utils/interestUtils";
import { validatePaymentRows } from "../../../../utils/excelValidator";
import { getFinancialYear } from "@/lib/date-utils";
import * as XLSX from "xlsx";

function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

// In-memory staging for preview→confirm flow
const staged = {};

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "preview";

    // ── PREVIEW ─────────────────────────────────────────────────────────────
    if (action === "preview") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

      const bytes = await file.arrayBuffer();
      const wb = XLSX.read(Buffer.from(bytes));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!rows.length) return NextResponse.json({ error: "Empty file" }, { status: 400 });

      const required = ["MemberId", "AmountPaid", "PaymentDate", "Month", "Year"];
      const headers = Object.keys(rows[0]);
      const missing = required.filter(c => !headers.includes(c));
      if (missing.length) {
        return NextResponse.json({ error: `Missing columns: ${missing.join(", ")}` }, { status: 400 });
      }

      const [members, society] = await Promise.all([
        Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
          .select("_id flatNo wing ownerName openingPrincipal openingInterest advanceCredit")
          .lean(),
        Society.findById(decoded.societyId).select("config").lean(),
      ]);
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));

      const preview = [];
      const errors = [];
      let totalAmount = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const memberId = String(row.MemberId || "").trim();
        const amountPaid = twoDp(parseFloat(row.AmountPaid) || 0);
        const month = parseInt(row.Month);
        const year = parseInt(row.Year);
        const paymentDate = row.PaymentDate ? new Date(row.PaymentDate) : new Date();
        const paymentMethod = String(row.PaymentMethod || "Cash").trim();
        const remarks = String(row.Remarks || "").trim();

        const rowErrors = [];
        if (!memberId) rowErrors.push("MemberId missing");
        const member = memberMap.get(memberId);
        if (memberId && !member) rowErrors.push("MemberId not found");
        if (amountPaid <= 0) rowErrors.push("AmountPaid must be > 0");
        if (isNaN(month) || month < 1 || month > 12) rowErrors.push("Month must be 1–12");
        if (isNaN(year) || year < 2000) rowErrors.push("Invalid Year");
        if (isNaN(paymentDate.getTime())) rowErrors.push("Invalid PaymentDate");

        // Duplicate check: same member already has payment in same period in this upload
        const dupInBatch = preview.find(p =>
          p.memberId === memberId && p.month === month && p.year === year && p.status !== "Failed"
        );
        if (dupInBatch) rowErrors.push("Duplicate row for same member+period");

        if (rowErrors.length) {
          errors.push({ rowNum, errors: rowErrors });
          preview.push({
            rowNum, memberId, amountPaid, month, year,
            memberName: member?.ownerName || "?",
            flat: member ? `${member.wing}-${member.flatNo}` : "?",
            paymentDate: paymentDate.toISOString().split("T")[0],
            paymentMethod, remarks,
            status: "Failed",
            errors: rowErrors,
          });
          continue;
        }

        totalAmount += amountPaid;
        const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
        const bill = await Bill.findOne({
          memberId, societyId: decoded.societyId, billPeriodId, isDeleted: { $ne: true },
        }).select("totalBillDue totalAmount billPrincipalBalance billInterestBalance principalBalance interestBalance balanceAmount amountPaid status").lean();

        const billDue = twoDp(bill?.totalBillDue || bill?.totalAmount || 0);
        const alreadyPaid = twoDp(bill?.amountPaid || 0);
        const remaining = twoDp(billDue - alreadyPaid);

        preview.push({
          rowNum, memberId,
          memberName: member.ownerName,
          flat: `${member.wing}-${member.flatNo}`,
          billPeriodId,
          month, year,
          amountPaid,
          paymentDate: paymentDate.toISOString().split("T")[0],
          paymentMethod, remarks,
          billDue,
          alreadyPaid,
          remaining,
          billFound: !!bill,
          billStatus: bill?.status || "No Bill",
          willOverpay: amountPaid > remaining && remaining > 0,
          status: "Valid",
          errors: [],
        });
      }

      const batchKey = `${decoded.societyId}-${Date.now()}`;
      staged[batchKey] = { rows: preview, decoded, fileName: file.name };

      // Build per-cell grid for ExcelPreviewGrid
      const validMemberIdSet = new Set(members.map((m) => m._id.toString()));
      // Build bill map for overpayment detection
      const billMap = new Map();
      for (const p of preview) {
        if (p.status === "Valid") {
          billMap.set(p.memberId, { balanceAmount: p.remaining });
        }
      }
      const { gridRows, summary: gridSummary } = validatePaymentRows(rows, {
        validMemberIds: validMemberIdSet,
        existingBillMap: billMap,
        today: new Date(),
      });
      const gridColumns = Object.keys(rows[0] || {});

      return NextResponse.json({
        success: true,
        batchKey,
        totalRows: rows.length,
        validRows: preview.filter(r => r.status === "Valid").length,
        failedRows: errors.length,
        totalAmount,
        preview,
        errors,
        gridRows,
        gridColumns,
        gridSummary,
      });
    }

    // ── CONFIRM ──────────────────────────────────────────────────────────────
    if (action === "confirm") {
      const { batchKey, notes } = await request.json();
      const batch = staged[batchKey];
      if (!batch) return NextResponse.json({ error: "Session expired. Re-upload file." }, { status: 400 });

      const { rows, decoded: dec, fileName } = batch;
      const validRows = rows.filter(r => r.status === "Valid");
      if (!validRows.length) return NextResponse.json({ error: "No valid rows to process" }, { status: 400 });

      const society = await Society.findById(dec.societyId).select("config").lean();
      const allocationMode = society?.config?.adjustmentApplicationMode || "INTEREST_FIRST";
      const financialYearFn = getFinancialYear;

      // Group rows by month/year to determine billPeriodId for import record
      const periodId = validRows[0].billPeriodId;
      const importMonth = validRows[0].month;
      const importYear = validRows[0].year;

      const importResults = [];
      let totalInterestCleared = 0;
      let totalPrincipalCleared = 0;
      let totalAdvanceCredit = 0;
      let totalAmountProcessed = 0;
      let successCount = 0;
      let failCount = 0;

      for (const row of validRows) {
        try {
          const member = await Member.findById(row.memberId).lean();
          if (!member) throw new Error("Member not found");

          const unpaidBills = await Bill.find({
            memberId: row.memberId,
            societyId: dec.societyId,
            status: { $in: ["Unpaid", "Partial", "Overdue"] },
            isDeleted: { $ne: true },
          }).sort({ billYear: 1, billMonth: 1 });

          const billsForAlloc = unpaidBills.map(b => ({
            _id: b._id,
            principalBalance: twoDp(b.billPrincipalBalance || b.principalBalance || 0),
            interestBalance: twoDp(b.billInterestBalance || b.interestBalance || 0),
            balanceAmount: twoDp(b.balanceAmount || 0),
            amountPaid: twoDp(b.amountPaid || 0),
            totalAmount: twoDp(b.totalBillDue || b.totalAmount || 0),
          }));

          const { billUpdates, totalInterestCleared: intClr, totalPrincipalCleared: prinClr, advanceCredit } =
            allocatePaymentInterestFirst(row.amountPaid, billsForAlloc, allocationMode);

          // Persist bill updates
          let primaryBillId = null;
          for (const upd of billUpdates) {
            const bill = unpaidBills.find(b => String(b._id) === String(upd.billId));
            if (!bill) continue;
            if (!primaryBillId) primaryBillId = bill._id;

            const eps = 0.005;
            const newClosingPrincipal = twoDp(upd.newPrincipalBalance) < eps ? 0 : twoDp(upd.newPrincipalBalance);
            const newClosingInterest = twoDp(upd.newInterestBalance) < eps ? 0 : twoDp(upd.newInterestBalance);

            bill.principalBalance = newClosingPrincipal;
            bill.interestBalance = newClosingInterest;
            bill.balanceAmount = twoDp(newClosingPrincipal + newClosingInterest);
            bill.amountPaid = twoDp(upd.newAmountPaid);
            bill.status = upd.newStatus;
            // Write immutable closing state
            bill.closingPrincipal = newClosingPrincipal;
            bill.closingInterest = newClosingInterest;
            bill.closingTotal = twoDp(newClosingPrincipal + newClosingInterest);
            bill.paymentUploadedAt = new Date();
            bill.lastModifiedAt = new Date();
            bill.lastModifiedBy = dec.userId;
            await bill.save();
          }

          // Advance credit
          if (advanceCredit > 0) {
            await Member.findByIdAndUpdate(row.memberId, { $inc: { advanceCredit } });
          }

          // Ledger transaction
          const lastTxn = await Transaction.findOne({
            memberId: row.memberId, societyId: dec.societyId, isReversed: false,
          }).sort({ date: -1, createdAt: -1 }).lean();
          const prevBal = twoDp(lastTxn?.balanceAfterTransaction ?? member.openingBalance ?? 0);
          const newBal = twoDp(prevBal - row.amountPaid);

          const txnId = Transaction.generateTransactionId();
          await Transaction.create({
            transactionId: txnId,
            date: new Date(row.paymentDate),
            memberId: row.memberId,
            societyId: dec.societyId,
            type: "Credit",
            category: "Payment",
            description: `Payment uploaded via Excel for ${row.billPeriodId}${row.remarks ? ` - ${row.remarks}` : ""}`,
            amount: row.amountPaid,
            interestCleared: twoDp(intClr),
            principalCleared: twoDp(prinClr),
            balanceAfterTransaction: newBal,
            paymentMode: row.paymentMethod || "Cash",
            chequeNo: row.chequeNo,
            bankName: row.bankName,
            upiId: row.upiId,
            notes: row.remarks,
            createdBy: dec.userId,
            billPeriodId: row.billPeriodId,
            financialYear: financialYearFn(new Date(row.paymentDate)),
            paymentBreakdown: {
              interestCleared: twoDp(intClr),
              principalCleared: twoDp(prinClr),
              advanceCredit: twoDp(advanceCredit),
            },
          });

          // Create receipt for each bill cleared in this payment
          const receiptNos = [];
          for (const upd of billUpdates) {
            const bill = unpaidBills.find(b => String(b._id) === String(upd.billId));
            if (!bill) continue;
            const receiptNo = `RCP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const nameParts = (member.ownerName || "member").trim().split(/\s+/);
            const nameSlug = nameParts.length > 1
              ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
              : nameParts[0];
            const flatSlug = `${member.wing || ""}-${member.flatNo || ""}`;
            const filename = `${nameSlug}_${flatSlug}_${bill.billPeriodId}_receipt`.replace(/[^a-zA-Z0-9_\-]/g, "_");
            await Receipt.create({
              receiptNo,
              filename,
              billId: bill._id,
              billPeriodId: bill.billPeriodId,
              memberId: row.memberId,
              societyId: dec.societyId,
              amount: twoDp(upd.newAmountPaid),
              previousBalanceSnapshot: 0,
              paymentMode: row.paymentMethod || "Cash",
              paidAt: new Date(row.paymentDate),
              transactionId: txnId,
              notes: row.remarks,
              status: "Generated",
            });
            receiptNos.push(receiptNo);
          }

          totalInterestCleared += intClr;
          totalPrincipalCleared += prinClr;
          totalAdvanceCredit += advanceCredit;
          totalAmountProcessed += row.amountPaid;
          successCount++;

          importResults.push({
            memberId: row.memberId,
            flat: row.flat,
            memberName: row.memberName,
            amountPaid: row.amountPaid,
            interestCleared: twoDp(intClr),
            principalCleared: twoDp(prinClr),
            advanceCredit: twoDp(advanceCredit),
            billId: primaryBillId,
            receiptNos,
            status: "Success",
          });
        } catch (err) {
          failCount++;
          importResults.push({
            memberId: row.memberId,
            flat: row.flat,
            memberName: row.memberName,
            amountPaid: row.amountPaid,
            status: "Failed",
            errorMessage: err.message,
          });
        }
      }

      // Create PaymentImport record
      const importRecord = await PaymentImport.create({
        societyId: dec.societyId,
        importMonth,
        importYear,
        billPeriodId: periodId,
        uploadedFileName: fileName,
        uploadedBy: dec.userId,
        totalRows: validRows.length,
        successRows: successCount,
        failedRows: failCount,
        totalAmountUploaded: twoDp(totalAmountProcessed),
        totalInterestCleared: twoDp(totalInterestCleared),
        totalPrincipalCleared: twoDp(totalPrincipalCleared),
        totalAdvanceCredit: twoDp(totalAdvanceCredit),
        rows: importResults.map(r => ({
          memberId: r.memberId,
          flatNo: r.flat?.split("-")[1],
          wing: r.flat?.split("-")[0],
          ownerName: r.memberName,
          amountPaid: r.amountPaid,
          interestCleared: r.interestCleared || 0,
          principalCleared: r.principalCleared || 0,
          advanceCredit: r.advanceCredit || 0,
          billId: r.billId,
          status: r.status,
          errorMessage: r.errorMessage,
        })),
        notes,
        status: "Completed",
      });

      delete staged[batchKey];

      return NextResponse.json({
        success: true,
        importId: importRecord._id,
        billPeriodId: periodId,
        totalRows: validRows.length,
        successRows: successCount,
        failedRows: failCount,
        totalAmountProcessed: twoDp(totalAmountProcessed),
        totalInterestCleared: twoDp(totalInterestCleared),
        totalPrincipalCleared: twoDp(totalPrincipalCleared),
        totalAdvanceCredit: twoDp(totalAdvanceCredit),
        results: importResults,
      });
    }

    return NextResponse.json({ error: "Invalid action. Use ?action=preview or ?action=confirm" }, { status: 400 });
  } catch (err) {
    console.error("upload-payments error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
