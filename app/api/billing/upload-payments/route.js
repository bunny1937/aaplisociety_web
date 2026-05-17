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

function parseExcelDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  // XLSX serial number: days since 1899-12-30
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("-");
    return new Date(`${yyyy}-${mm}-${dd}`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// In-memory staging for preview→confirm flow
const staged = {};

export async function POST(request) {
  try {
    await connectDB();

    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "preview";

    // ── PREVIEW ─────────────────────────────────────────────────────────────
    if (action === "preview") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file)
        return NextResponse.json(
          { error: "No file uploaded" },
          { status: 400 },
        );

      const bytes = await file.arrayBuffer();
      const wb = XLSX.read(Buffer.from(bytes), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (!rows.length)
        return NextResponse.json({ error: "Empty file" }, { status: 400 });

      // Validate required columns — accept merged "Wing-FlatNo" or legacy separate Wing+FlatNo
      const headers = Object.keys(rows[0]);
      const hasMergedCol = headers.includes("Wing-FlatNo");
      const hasLegacyCols = headers.includes("Wing") && headers.includes("FlatNo");
      if (!hasMergedCol && !hasLegacyCols) {
        return NextResponse.json(
          { error: "Missing column: Wing-FlatNo (or legacy Wing and FlatNo columns)" },
          { status: 400 },
        );
      }
      const otherRequired = ["AmountPaid", "PaymentDate"];
      const missing = otherRequired.filter((c) => !headers.includes(c));
      if (missing.length) {
        return NextResponse.json(
          { error: `Missing columns: ${missing.join(", ")}` },
          { status: 400 },
        );
      }

      // Normalize Period → Month/Year if needed
      const hasPeriodCol = headers.includes("Period");
      if (hasPeriodCol) {
        rows.forEach((r) => {
          if (r.Period && !r.Month) {
            const [y, m] = String(r.Period).split("-");
            r.Year = parseInt(y);
            r.Month = parseInt(m);
          }
        });
      }

      const [members, society] = await Promise.all([
        Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
          .select(
            "_id flatNo wing ownerName openingPrincipal openingInterest advanceCredit",
          )
          .lean(),
        Society.findById(decoded.societyId).select("config").lean(),
      ]);
      const memberMap = new Map(members.map((m) => [m._id.toString(), m]));
      const wingFlatMap = new Map(
        members.map((m) => [
          `${(m.wing || "").trim().toLowerCase()}-${(m.flatNo || "").trim().toLowerCase()}`,
          m,
        ]),
      );

      const preview = [];
      const errors = [];
      let totalAmount = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
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

        // Skip instruction row
        if (wing.startsWith("⚠") || wingFlatRaw.startsWith("⚠") || (!wing && !flatNo)) continue;
        // Skip rows with no payment
        const _amtRaw = String(row.AmountPaid ?? "").trim();
        if (!_amtRaw) continue;

        const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;
        const member = wingFlatMap.get(flatKey);
        const memberId = member?._id.toString();

        const amountPaid = twoDp(parseFloat(row.AmountPaid) || 0);
        const month = parseInt(row.Month);
        const year = parseInt(row.Year);
        const paymentDate = parseExcelDate(row.PaymentDate) || new Date();
        const paymentMethod = String(row.PaymentMethod || "Cash").trim();
        const remarks = String(row.Remarks || "").trim();

        const rowErrors = [];
        if (!member) rowErrors.push(`Flat "${wing}-${flatNo}" not found`);
        if (amountPaid <= 0) rowErrors.push("AmountPaid must be > 0");
        if (isNaN(month) || month < 1 || month > 12)
          rowErrors.push("Month must be 1–12");
        if (isNaN(year) || year < 2000) rowErrors.push("Invalid Year");
        if (isNaN(paymentDate?.getTime()))
          rowErrors.push("Invalid PaymentDate");

        // Duplicate check
        const dupInBatch = preview.find(
          (p) =>
            p.memberId === memberId &&
            p.month === month &&
            p.year === year &&
            p.status !== "Failed",
        );
        if (dupInBatch) rowErrors.push("Duplicate row for same flat+period");

        if (rowErrors.length) {
          errors.push({ rowNum, errors: rowErrors });
          preview.push({
            rowNum,
            memberId,
            amountPaid,
            month,
            year,
            memberName: member?.ownerName || "?",
            flat: member ? `${member.wing}-${member.flatNo}` : "?",
            paymentDate: paymentDate.toISOString().split("T")[0],
            paymentMethod,
            remarks,
            status: "Failed",
            errors: rowErrors,
          });
          continue;
        }

        totalAmount += amountPaid;
        const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
        const bill = await Bill.findOne({
          memberId,
          societyId: decoded.societyId,
          billPeriodId,
          isDeleted: { $ne: true },
        })
          .select(
            "totalBillDue totalAmount billPrincipalBalance billInterestBalance principalBalance interestBalance balanceAmount advanceApplied amountPaid status",
          )
          .lean();

        const billDue = twoDp(bill?.totalBillDue || bill?.totalAmount || 0);
        const alreadyPaid = twoDp(bill?.amountPaid || 0);
        // Use live balanceAmount (net of advance) — falls back to gross - paid for new bills
        const remaining = twoDp(
          bill?.balanceAmount != null
            ? Math.max(0, bill.balanceAmount)
            : Math.max(0, billDue - alreadyPaid),
        );

        preview.push({
          rowNum,
          memberId,
          memberName: member.ownerName,
          flat: `${member.wing}-${member.flatNo}`,
          billPeriodId,
          month,
          year,
          amountPaid,
          paymentDate: paymentDate.toISOString().split("T")[0],
          paymentMethod,
          remarks,
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

      // Build bill map keyed by wing-flatno for grid validation (overpayment + tamper detection)
      const billMap = new Map();
      for (const p of preview) {
        if (p.status === "Valid") {
          // Find the bill we fetched to pass tamper-check fields
          const bill = await Bill.findOne({
            memberId: p.memberId,
            societyId: decoded.societyId,
            billPeriodId: p.billPeriodId,
            isDeleted: { $ne: true },
          })
            .select("totalBillDue openingPrincipal openingInterest balanceAmount")
            .lean();
          billMap.set(p.flat.toLowerCase(), {
            balanceAmount: p.remaining,
            totalBillDue: bill?.totalBillDue ?? p.billDue,
            openingPrincipal: bill?.openingPrincipal ?? null,
            openingInterest: bill?.openingInterest ?? null,
          });
        }
      }
      const { gridRows, summary: gridSummary } = validatePaymentRows(rows, {
        wingFlatMap,
        existingBillMap: billMap,
        today: new Date(),
      });
      const gridColumns = Object.keys(rows[0] || {});

      return NextResponse.json({
        success: true,
        batchKey,
        totalRows: rows.length,
        validRows: preview.filter((r) => r.status === "Valid").length,
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
      if (!batch)
        return NextResponse.json(
          { error: "Session expired. Re-upload file." },
          { status: 400 },
        );

      const { rows, decoded: dec, fileName } = batch;
      const validRows = rows.filter((r) => r.status === "Valid");
      if (!validRows.length)
        return NextResponse.json(
          { error: "No valid rows to process" },
          { status: 400 },
        );

      const society = await Society.findById(dec.societyId)
        .select("config")
        .lean();
      const allocationMode =
        society?.config?.adjustmentApplicationMode || "INTEREST_FIRST";
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

          // CHANGE TO:
          const unpaidBills = await Bill.find({
            memberId: row.memberId,
            societyId: dec.societyId,
            billPeriodId: row.billPeriodId, // ← scope to the period being paid
            status: { $in: ["Unpaid", "Partial", "Overdue"] },
            isDeleted: { $ne: true },
          }).sort({ billYear: 1, billMonth: 1 });

          const billsForAlloc = unpaidBills.map((b) => {
            const intBal = twoDp(b.interestBalance || 0);
            const prinBal = twoDp(b.principalBalance || 0);
            const bal = twoDp(b.balanceAmount || 0);
            // If principal+interest don't add up to balanceAmount (legacy bills),
            // treat the entire balanceAmount as principal so allocation can clear it.
            const effectivePrincipal =
              prinBal + intBal < bal - 0.005 ? bal - intBal : prinBal;
            return {
              _id: b._id,
              principalBalance: effectivePrincipal,
              interestBalance: intBal,
              balanceAmount: bal,
              amountPaid: twoDp(b.amountPaid || 0),
              totalAmount: twoDp(b.totalBillDue || b.totalAmount || 0),
            };
          });

          const {
            billUpdates,
            totalInterestCleared: intClr,
            totalPrincipalCleared: prinClr,
            advanceCredit,
          } = allocatePaymentInterestFirst(
            row.amountPaid,
            billsForAlloc,
            allocationMode,
          );

          // Persist bill updates
          let primaryBillId = null;
          const preMutationBalance = new Map(); // billId → balanceAmount before payment
          for (const upd of billUpdates) {
            const bill = unpaidBills.find(
              (b) => String(b._id) === String(upd.billId),
            );
            if (!bill) continue;
            if (!primaryBillId) primaryBillId = bill._id;
            preMutationBalance.set(String(bill._id), twoDp(bill.balanceAmount));

            const eps = 0.005;
            const newClosingPrincipal =
              twoDp(upd.newPrincipalBalance) < eps
                ? 0
                : twoDp(upd.newPrincipalBalance);
            const newClosingInterest =
              twoDp(upd.newInterestBalance) < eps
                ? 0
                : twoDp(upd.newInterestBalance);
            const newBalanceAmount =
              twoDp(upd.newBalanceAmount) < eps
                ? 0
                : twoDp(upd.newBalanceAmount);

            // TO:
            bill.interestBalance = newClosingInterest;
            bill.principalBalance = twoDp(
              Math.max(0, newBalanceAmount - newClosingInterest),
            ); // principal = whatever is left after interest portion
            bill.balanceAmount = newBalanceAmount;
            bill.amountPaid = twoDp(upd.newAmountPaid);
            bill.status = upd.newStatus;
            // Write immutable closing state
            bill.closingPrincipal = newClosingPrincipal;
            bill.closingInterest = newClosingInterest;
            bill.closingTotal = newBalanceAmount;
            bill.paymentUploadedAt = new Date();
            bill.lastModifiedAt = new Date();
            bill.lastModifiedBy = dec.userId;
            await bill.save();

            // When a bill is fully paid and it absorbed prior-period outstanding,
            // mark those prior bills' balanceAmount=0 so they don't double-count
            // in future get-previous-balances calls.
            if (upd.newStatus === "Paid" && (bill.openingPrincipal > 0 || bill.openingInterest > 0)) {
              await Bill.updateMany(
                {
                  memberId: row.memberId,
                  societyId: dec.societyId,
                  billPeriodId: { $lt: bill.billPeriodId },
                  balanceAmount: { $gt: 0.005 },
                  isDeleted: { $ne: true },
                },
                {
                  $set: {
                    balanceAmount: 0,
                    principalBalance: 0,
                    interestBalance: 0,
                    status: "Paid",
                    closingPrincipal: 0,
                    closingInterest: 0,
                    closingTotal: 0,
                    lastModifiedAt: new Date(),
                    lastModifiedBy: dec.userId,
                  },
                },
              );
            }
          }

          // Advance credit
          if (advanceCredit > 0) {
            await Member.findByIdAndUpdate(row.memberId, {
              $inc: { advanceCredit },
            });
          }

          // Ledger transaction
          const lastTxn = await Transaction.findOne({
            memberId: row.memberId,
            societyId: dec.societyId,
            isReversed: false,
          })
            .sort({ date: -1, createdAt: -1 })
            .lean();
          const prevBal = twoDp(
            lastTxn?.balanceAfterTransaction ?? member.openingBalance ?? 0,
          );
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

          // Create receipt for each bill touched in this payment — amount = what was applied to that bill
          const receiptNos = [];
          for (const upd of billUpdates) {
            const bill = unpaidBills.find(
              (b) => String(b._id) === String(upd.billId),
            );
            if (!bill) continue;
            const amountApplied = twoDp(
              parseFloat(upd.principalCleared) +
                parseFloat(upd.interestCleared),
            );
            if (amountApplied <= 0) continue; // skip bills that received nothing
            const receiptNo = `RCP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            const nameParts = (member.ownerName || "member")
              .trim()
              .split(/\s+/);
            const nameSlug =
              nameParts.length > 1
                ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
                : nameParts[0];
            const flatSlug = `${member.wing || ""}-${member.flatNo || ""}`;
            const filename =
              `${nameSlug}_${flatSlug}_${bill.billPeriodId}_receipt`.replace(
                /[^a-zA-Z0-9_\-]/g,
                "_",
              );
            await Receipt.create({
              receiptNo,
              filename,
              billId: bill._id,
              billPeriodId: bill.billPeriodId,
              memberId: row.memberId,
              societyId: dec.societyId,
              amount: amountApplied,
              previousBalanceSnapshot:
                preMutationBalance.get(String(bill._id)) ?? 0,
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
        rows: importResults.map((r) => ({
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

    return NextResponse.json(
      { error: "Invalid action. Use ?action=preview or ?action=confirm" },
      { status: 400 },
    );
  } catch (err) {
    console.error("upload-payments error:", err);
    return NextResponse.json(
      { error: "Internal server error", details: err.message },
      { status: 500 },
    );
  }
}
