import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import { join } from "path";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Receipt from "@/models/Receipt";
import Society from "@/models/Society";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer"; // ← default import NOT named { renderBillHtml }
import { FlexiblePDFGenerator } from "@/lib/pdf-generator";
function formatMoney(value) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function formatDateForPdf(dateValue) {
  return new Date(dateValue).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
async function appendReceiptPage(pdfDoc, receipt, bill, society, member) {
  if (!receipt) return;
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { height } = page.getSize();
  const margin = 40;
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const drawLine = (label, value, y) => {
    page.drawText(label, {
      x: margin,
      y,
      size: 11,
      font: bodyFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    page.drawText(value || "-", {
      x: 180,
      y,
      size: 11,
      font: titleFont,
      color: rgb(0.12, 0.12, 0.12),
    });
  };
  page.drawText("Previous Paid Receipt", {
    x: margin,
    y: height - 60,
    size: 18,
    font: titleFont,
    color: rgb(0.12, 0.28, 0.6),
  });
  page.drawText(society?.name || "", {
    x: margin,
    y: height - 82,
    size: 11,
    font: bodyFont,
    color: rgb(0.35, 0.35, 0.35),
  });
  drawLine("Receipt No.", receipt.receiptNo, height - 120);
  drawLine(
    "Paid At",
    new Date(receipt.paidAt).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    height - 140,
  );
  drawLine("Member", member?.ownerName || "", height - 160);
  drawLine(
    "Flat",
    `${member?.wing || ""}-${member?.flatNo || ""}`,
    height - 180,
  );
  drawLine(
    "Bill Period",
    receipt.billPeriodId || bill.billPeriodId,
    height - 200,
  );
  drawLine("Payment Mode", receipt.paymentMode, height - 220);
  drawLine("Transaction ID", receipt.transactionId, height - 240);
  drawLine("Receipt Amount", formatMoney(receipt.amount), height - 260);
  page.drawRectangle({
    x: margin,
    y: height - 340,
    width: 515.28,
    height: 70,
    color: rgb(0.97, 0.98, 1),
    borderColor: rgb(0.74, 0.79, 0.9),
    borderWidth: 1,
  });
  page.drawText("Bill Reference", {
    x: margin + 16,
    y: height - 300,
    size: 12,
    font: titleFont,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawText(`Previous balance: ${formatMoney(bill.previousBalance)}`, {
    x: margin + 16,
    y: height - 318,
    size: 11,
    font: bodyFont,
    color: rgb(0.25, 0.25, 0.25),
  });
  page.drawText(`Interest: ${formatMoney(bill.interestAmount)}`, {
    x: margin + 16,
    y: height - 334,
    size: 11,
    font: bodyFont,
    color: rgb(0.25, 0.25, 0.25),
  });
}
export async function GET(request) {
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    const { searchParams } = new URL(request.url);
    const billId = searchParams.get("id");
    if (!billId || billId === "undefined" || billId === "null") {
      return NextResponse.json({ error: "Bill ID required" }, { status: 400 });
    }
    const memberIdFilter = decoded.memberId
      ? { memberId: decoded.memberId }
      : {};
    const bill = await Bill.findOne({
      _id: billId,
      societyId: decoded.societyId,
      ...memberIdFilter,
    })
      .populate(
        "memberId",
        "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary",
      )
      .lean();
    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }
    const society = await Society.findById(decoded.societyId).lean();
    const hasPdfTemplate = Boolean(society?.billTemplate?.pdfUrl);
    const member = bill.memberId;
    const currentBillTotal = Number(
      bill.currentBillTotal ?? bill.totalAmount ?? 0,
    );
    const previousBalance = Number(bill.previousBalance || 0);
    const interestAmount = Number(bill.interestAmount || 0);
    const totalPayable = +(
      currentBillTotal +
      previousBalance +
      interestAmount
    ).toFixed(2);
    // ─── Fetch previous bill HTML for ALL cases (page 3 prev receipt) ───
    const prevBill = await Bill.findOne({
      memberId: bill.memberId?._id || bill.memberId,
      societyId: decoded.societyId,
      billPeriodId: { $lt: bill.billPeriodId }, // strictly earlier period
      billHtml: { $exists: true, $ne: null },
    })
      .sort({ billYear: -1, billMonth: -1 })
      .lean();
    const prevBillPage = prevBill?.billHtml
      ? `<div style="page-break-before:always; padding:40px; background:#fff;">
          <div style="border-bottom:2px solid #e5e7eb; padding-bottom:12px; margin-bottom:24px;">
            <h2 style="margin:0; font-size:16px; color:#6b7280;">
              📎 Previous Month's Bill — ${prevBill.billPeriodId} (Reference Copy)
            </h2>
          </div>
          ${prevBill.billHtml}
        </div>`
      : "";
    // ─── Shared filename slug ───
    const ownerRaw = bill.memberId?.ownerName || "Member";
    const nameParts = ownerRaw.trim().split(/\s+/);
    const nameSlug =
      nameParts.length > 1
        ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
        : nameParts[0];
    const pdfTitle =
      `${nameSlug}_${bill.memberId?.wing}-${bill.memberId?.flatNo}_${bill.billPeriodId}`
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const printButton = `<div style="text-align:center; margin: 24px 0; padding-bottom: 16px;">
      <button onclick="window.print()" style="background:#0c4e54;color:white;border:none;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;">
        🖨️ Print / Save as PDF
      </button>
    </div>`;
    const htmlWrapper = (body) => `<!DOCTYPE html><html>
<head>
  <title>${pdfTitle}</title>
  <meta charset="UTF-8"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #1a1a1a; }
    @media print {
      body { background: white; padding: 0; }
      .bill-wrapper { box-shadow: none !important; border-radius: 0 !important; }
      @page { margin: 8mm; size: A4; }
    }
  </style>
</head>
<body>${body}${printButton}</body>
</html>`;
    // ─── Case 1: Custom PDF template exists — keep the uploaded PDF format ───
    if (hasPdfTemplate) {
      const templatePath = join(
        process.cwd(),
        "public",
        society.billTemplate.pdfUrl,
      );
      const generator = new FlexiblePDFGenerator(templatePath);
      const items = Object.entries(bill.charges || {}).map(
        ([description, amount]) => ({
          description,
          quantity: 1,
          rate: Number(amount || 0),
          amount: Number(amount || 0),
        }),
      );
      const paymentDetails = [
        `Previous dues: ${formatMoney(previousBalance)}`,
        `Interest: ${formatMoney(interestAmount)}`,
        `Total payable: ${formatMoney(totalPayable)}`,
      ].join(" | ");
      const formFieldData = {
        "Company name": society.name || "",
        Address: society.address || "",
        "GST number": society.gstNumber || "N/A",
        "Invoice number": bill.billPeriodId || pdfTitle,
        "Invoice date_af_date": formatDateForPdf(
          bill.generatedAt || bill.createdAt,
        ),
        "Bill date_af_date": formatDateForPdf(
          bill.generatedAt || bill.createdAt,
        ),
        "Due date_af_date": formatDateForPdf(bill.dueDate || new Date()),
        "Customer name": member?.ownerName || "",
        "Customer address": `${member?.wing || ""}-${member?.flatNo || ""}`,
        "Customer phone": member?.contactNumber || "",
        "Customer GST number": "N/A",
        "Sub Total": Number(currentBillTotal || 0).toFixed(2),
        Discount: "0",
        "Tax Rate": "0",
        "Tax value": Number(bill.serviceTax || 0).toFixed(2),
        Shipping: "0",
        "Previous dues": Number(previousBalance || 0).toFixed(2),
        "Grand total": Number(totalPayable || 0).toFixed(2),
        "Account holder name": society.bankDetails?.accountHolderName || "",
        "Account number": society.bankDetails?.accountNumber || "",
        "Bank name": society.bankDetails?.bankName || "",
        "IFSC Code": society.bankDetails?.ifscCode || "",
      };
      items.slice(0, 6).forEach((item, index) => {
        const productNum = index + 1;
        formFieldData[`Product #${productNum}`] = item.description || "";
        formFieldData[`Product #${productNum} amount`] = Number(
          item.amount || 0,
        ).toFixed(2);
        formFieldData[`Product #${productNum} Rate`] = Number(
          item.rate || 0,
        ).toFixed(2);
        formFieldData[`Qty #${productNum}`] = String(item.quantity || 1);
        formFieldData[`HSN code #${productNum}`] = item.hsnCode || "";
      });
      const pdfBytes = await generator.generateBill({
        companyName: society.name || "",
        invoiceNumber: bill.billPeriodId || pdfTitle,
        customerName: member?.ownerName || "",
        customerAddress: `${member?.wing || ""}-${member?.flatNo || ""}`,
        customerPhone: member?.contactNumber || "",
        billDate: bill.generatedAt || bill.createdAt || new Date(),
        dueDate: bill.dueDate || new Date(),
        items,
        subtotal: currentBillTotal,
        tax: bill.serviceTax || 0,
        total: totalPayable,
        paymentDetails,
        formFieldData,
      });
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const previousReceipt = await Receipt.findOne({
        memberId: bill.memberId?._id || bill.memberId,
        societyId: decoded.societyId,
        billPeriodId: { $lt: bill.billPeriodId },
      })
        .sort({ billPeriodId: -1, paidAt: -1 })
        .lean();
      await appendReceiptPage(pdfDoc, previousReceipt, bill, society, member);
      const finalPdf = await pdfDoc.save();
      return new NextResponse(Buffer.from(finalPdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${pdfTitle}.pdf"`,
        },
      });
    }
    // ─── Case 2: Bill has stored HTML ───
    if (bill.billHtml) {
      return new NextResponse(htmlWrapper(`${bill.billHtml}${prevBillPage}`), {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `inline; filename="${pdfTitle}.html"`,
        },
      });
    }
    // ─── Case 3: No stored HTML, no PDF template — re-render ───
    if (!hasPdfTemplate) {
      const renderResult = renderBillHtml(null, society, member, {
        breakdown: bill.charges || {},
        totalAmount: bill.totalAmount,
        previousBalance: bill.previousBalance || 0,
        billPeriod: bill.billPeriodId,
        billDate: bill.generatedAt || bill.createdAt,
        dueDate: bill.dueDate,
        unpaidBills: bill.unpaidBills || [],
        recentTransactions: bill.recentTransactions || [],
        previousBillHtml: prevBill?.billHtml || null, // appended inside renderer too
      });
      return new NextResponse(htmlWrapper(renderResult.html), {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": `inline; filename="${pdfTitle}.html"`,
        },
      });
    }
    const renderResult = renderBillHtml(null, society, member, {
      breakdown: bill.charges || {},
      totalAmount: bill.totalAmount,
      previousBalance: bill.previousBalance || 0,
      billPeriod: bill.billPeriodId,
      billDate: bill.generatedAt || bill.createdAt,
      dueDate: bill.dueDate,
      unpaidBills: bill.unpaidBills || [],
      recentTransactions: bill.recentTransactions || [],
      previousBillHtml: prevBill?.billHtml || null,
    });
    return new NextResponse(htmlWrapper(renderResult.html), {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `inline; filename="${pdfTitle}.html"`,
      },
    });
  } catch (error) {
    console.error("❌ Download error:", error);
    return NextResponse.json(
      { error: "Failed", details: error.message },
      { status: 500 },
    );
  }
}
// import { NextResponse } from "next/server";
// import { PDFDocument } from "pdf-lib";
// import { readFile } from "fs/promises";
// import { join } from "path";
// import connectDB from "@/lib/mongodb";
// import Bill from "@/models/Bill";
// import Society from "@/models/Society";
// import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
// import renderBillHtml from "@/lib/bill-renderer"; // default export — NOT named { renderBillHtml }
// export async function GET(request) {
//   try {
//     await connectDB();
//     const token = getTokenFromRequest(request);
//     if (!token) {
//       return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
//     }
//     const decoded = verifyToken(token);
//     const { searchParams } = new URL(request.url);
//     const billId = searchParams.get("id");
//     if (!billId || billId === "undefined" || billId === "null") {
//       return NextResponse.json({ error: "Bill ID required" }, { status: 400 });
//     }
//     // Get bill
//     const memberIdFilter = decoded.memberId
//       ? { memberId: decoded.memberId }
//       : {};
//     const bill = await Bill.findOne({
//       _id: billId,
//       societyId: decoded.societyId,
//       ...memberIdFilter,
//     })
//       .populate(
//         "memberId",
//         "flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary",
//       )
//       .lean();
//     if (!bill) {
//       return NextResponse.json({ error: "Bill not found" }, { status: 404 });
//     }
//     const society = await Society.findById(decoded.societyId).lean();
//     // Helper — shared across all cases
//     const ownerRaw = bill.memberId?.ownerName || "Member";
//     const nameParts = ownerRaw.trim().split(/\s+/);
//     const nameSlug =
//       nameParts.length > 1
//         ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
//         : nameParts[0];
//     const pdfTitle =
//       `${nameSlug}_${bill.memberId?.wing}-${bill.memberId?.flatNo}_${bill.billPeriodId}`
//         .replace(/\s+/g, "_")
//         .replace(/[^a-zA-Z0-9_\-\.]/g, "");
//     // Case 1: Bill has stored HTML — serve directly, append previous bill as page 3
//     if (bill.billHtml) {
//       // Fetch previous bill for reference page
//       const prevBill = await Bill.findOne({
//         memberId: bill.memberId?._id || bill.memberId,
//         societyId: decoded.societyId,
//         billPeriodId: { $lt: bill.billPeriodId }, // strictly earlier period
//         billHtml: { $exists: true, $ne: null },
//       })
//         .sort({ billYear: -1, billMonth: -1 })
//         .lean();
//       const prevBillPage = prevBill?.billHtml
//         ? `<div style="page-break-before:always; padding:40px; background:#fff;">
//             <div style="border-bottom:2px solid #e5e7eb; padding-bottom:12px; margin-bottom:24px;">
//               <h2 style="margin:0; font-size:16px; color:#6b7280;">📎 Previous Month's Bill — ${prevBill.billPeriodId} (Reference Copy)</h2>
//             </div>
//             ${prevBill.billHtml}
//            </div>`
//         : "";
//       const html = `<!DOCTYPE html><html><head><title>${pdfTitle}</title><meta charset="UTF-8">
//   <style>
//     *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
//     body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #1a1a1a; }
//     @media print { body { background: white; padding: 0; } .bill-wrapper { box-shadow: none !important; border-radius: 0 !important; } @page { margin: 8mm; size: A4; } }
//   </style>
// </head><body>
//    ${bill.billHtml}
//    ${prevBillPage}
//   <div style="text-align:center; margin: 24px 0; padding-bottom: 16px;">
//     <button onclick="window.print()" style="background:#0c4e54;color:white;border:none;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;">
//       🖨️ Print / Save as PDF
//     </button>
//   </div>
// </body></html>`;
//       return new NextResponse(html, {
//         headers: {
//           "Content-Type": "text/html",
//           "Content-Disposition": `inline; filename="Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.html"`,
//         },
//       });
//     }
//     // Case 2: No stored HTML — re-render using renderBillHtml
//     if (!society?.billTemplate?.pdfUrl) {
//       const member = bill.memberId; // already populated via .populate()
//       const renderResult = renderBillHtml(null, society, member, {
//         breakdown: bill.charges || {},
//         totalAmount: bill.totalAmount,
//         previousBalance: bill.previousBalance || 0,
//         billPeriod: bill.billPeriodId,
//         billDate: bill.generatedAt || bill.createdAt,
//         dueDate: bill.dueDate,
//         unpaidBills: bill.unpaidBills || [],
//         recentTransactions: bill.recentTransactions || [],
//       });
//       const fullHtml = `<!DOCTYPE html>
// <html>
// <head>
//   <title>${pdfTitle}</title>
//   <meta charset="UTF-8"/>
//   <style>
//     *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
//     body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #1a1a1a; }
//     @media print {
//       body { background: white; padding: 0; }
//       @page { margin: 8mm; size: A4; }
//       .page-break { page-break-before: always; }
//     }
//   </style>
// </head>
// <body>
// ${renderResult.billHtml}
//   <div style="text-align:center; margin: 24px 0; padding-bottom: 16px;">
//     <button onclick="window.print()" style="background:#0c4e54;color:white;border:none;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:600;cursor:pointer;">
//       🖨️ Print / Save as PDF
//     </button>
//   </div>
// </body>
// </html>`;
//       return new NextResponse(fullHtml, {
//         headers: {
//           "Content-Type": "text/html",
//           "Content-Disposition": `inline; filename="${pdfTitle}.html"`,
//         },
//       });
//     }
//     // Case 3: PDF template exists — fill with pdf-lib
//     const templatePath = join(
//       process.cwd(),
//       "public",
//       society.billTemplate.pdfUrl,
//     );
//     const pdfBytes = await readFile(templatePath);
//     const pdfDoc = await PDFDocument.load(pdfBytes);
//     const form = pdfDoc.getForm();
//     const fields = form.getFields();
//     const formatDate = (date) => {
//       return new Date(date).toLocaleDateString("en-IN", {
//         day: "2-digit",
//         month: "short",
//         year: "numeric",
//       });
//     };
//     const billData = {
//       "Company name": society.name,
//       Address: society.address,
//       "GST number": society.gstNumber || "N/A",
//       "Invoice number": `INV-${bill._id.toString().slice(-6).toUpperCase()}`,
//       "Invoice date_af_date": formatDate(bill.generatedAt || bill.createdAt),
//       "Bill date_af_date": formatDate(bill.generatedAt || bill.createdAt),
//       "Due date_af_date": formatDate(bill.dueDate),
//       "Customer name": bill.memberId?.ownerName || "N/A",
//       "Customer address": `${bill.memberId?.wing || ""}-${bill.memberId?.flatNo || ""}`,
//       "Customer phone": bill.memberId?.contactNumber || "",
//       "Customer GST number": "N/A",
//       "Sub Total": (bill.subtotal || bill.currentBillTotal || 0).toFixed(2),
//       Discount: "0",
//       "Tax Rate": "0",
//       "Tax value": (bill.serviceTax || 0).toFixed(2),
//       Shipping: "0",
//       "Previous dues": (bill.previousBalance || 0).toFixed(2),
//       "Grand total": bill.totalAmount.toFixed(2),
//       "Account holder name": society.bankDetails?.accountHolderName || "",
//       "Account number": society.bankDetails?.accountNumber || "",
//       "Bank name": society.bankDetails?.bankName || "",
//       "IFSC Code": society.bankDetails?.ifscCode || "",
//     };
//     if (bill.charges) {
//       Object.entries(bill.charges).forEach(([chargeName, amount], index) => {
//         const productNum = index + 1;
//         if (productNum <= 6) {
//           billData[`Product #${productNum}`] = chargeName;
//           billData[`Product #${productNum} amount`] = amount.toFixed(2);
//           billData[`Product #${productNum} Rate`] = amount.toFixed(2);
//           billData[`Qty #${productNum}`] = "1";
//           billData[`HSN code #${productNum}`] = "";
//         }
//       });
//     }
//     console.log(
//       "📋 Filling PDF with data:",
//       Object.keys(billData).filter((k) => billData[k]),
//     );
//     fields.forEach((field) => {
//       const fieldName = field.getName();
//       const value = billData[fieldName];
//       if (value) {
//         try {
//           field.setText(String(value));
//           console.log(`✅ Filled: ${fieldName} = ${value}`);
//         } catch (err) {
//           console.log(`⚠️ Skip: ${fieldName} - ${err.message}`);
//         }
//       }
//     });
//     form.flatten();
//     const filledPdf = await pdfDoc.save();
//     return new NextResponse(filledPdf, {
//       headers: {
//         "Content-Type": "application/pdf",
//         "Content-Disposition": `attachment; filename="Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf"`,
//       },
//     });
//   } catch (error) {
//     console.error("❌ Download error:", error);
//     return NextResponse.json(
//       { error: "Failed", details: error.message },
//       { status: 500 },
//     );
//   }
// }
