import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import Receipt from "@/models/Receipt";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import Member from "@/models/Member";

export async function GET(request, { params }) {
  try {
    await connectDB();
    const { id } = await params;
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded || !decoded.memberId)
      return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const receipt = await Receipt.findOne({
      _id: id,
      memberId: decoded.memberId,
    }).lean();
    if (!receipt)
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

    const [bill, society, member] = await Promise.all([
      Bill.findById(receipt.billId).lean(),
      Society.findById(decoded.societyId).select("name address").lean(),
      Member.findById(decoded.memberId)
        .select(
          "ownerName wing flatNo contactNumber emailPrimary carpetAreaSqft membershipNumber",
        )
        .lean(),
    ]);

    const html = generateReceiptHtml({ receipt, bill, society, member });

    // Mark as downloaded
    await Receipt.findByIdAndUpdate(id, { status: "Downloaded" });

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
        "Content-Disposition": `inline; filename="${receipt.filename || receipt.receiptNo || "receipt"}.html"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 },
    );
  }
}

function generateReceiptHtml({ receipt, bill, society, member }) {
  const formatDate = (d) =>
    new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const baseCharges = bill?.charges ? Object.entries(bill.charges) : [];
  const allChargeRows = [
    ...baseCharges,
    ...(bill?.interestAmount > 0
      ? [["Interest on Arrears", bill.interestAmount]]
      : []),
    ...((receipt.previousBalanceSnapshot ?? bill?.previousBalance ?? 0) > 0
      ? [
          [
            "Previous Balance",
            receipt.previousBalanceSnapshot ?? bill.previousBalance,
          ],
        ]
      : []),
  ];

  return `<!DOCTYPE html>
<html>
<head>
  <title>${receipt.filename || receipt.receiptNo || "Receipt"}</title>
  <meta charset="UTF-8"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 30px; color: #1a1a1a; }
    .wrapper { max-width: 680px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #059669, #10b981); color: white; padding: 32px; text-align: center; }
    .checkmark { font-size: 48px; margin-bottom: 12px; }
    .header h1 { font-size: 28px; margin-bottom: 4px; }
    .receipt-no { font-size: 13px; opacity: 0.85; margin-top: 6px; }
    .society-name { font-size: 16px; margin-top: 8px; opacity: 0.9; }
    .body { padding: 32px; }
    .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #F3F4F6; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .label { color: #6B7280; }
    .value { font-weight: 600; color: #1F2937; }
    .charges-section { background: #F9FAFB; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .charges-title { font-size: 13px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px; }
    .charge-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; }
    .total-box { background: #ECFDF5; border: 2px solid #059669; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
    .total-label { font-size: 13px; color: #065F46; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .total-amount { font-size: 36px; font-weight: 700; color: #059669; }
    .footer { background: #F9FAFB; padding: 20px 32px; text-align: center; font-size: 11px; color: #9CA3AF; border-top: 1px solid #E5E7EB; }
    @media print {
  body { background: white; padding: 0; }
  .bill-wrapper { box-shadow: none; border-radius: 0; }
  @page { margin: 8mm; size: A4; }
  .page-break { page-break-before: always; }
}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="checkmark">✅</div>
      <h1>Payment Receipt</h1>
      <div class="receipt-no">Receipt No: ${receipt.receiptNo}</div>
      <div class="society-name">${society?.name || ""}</div>
    </div>
    <div class="body">
      <div class="row"><span class="label">Date of Payment</span><span class="value">${formatDate(receipt.paidAt)}</span></div>
      <div class="row"><span class="label">Member Name</span><span class="value">${member?.ownerName || ""}</span></div>
      <div class="row"><span class="label">Flat No.</span><span class="value">${member?.wing}-${member?.flatNo}</span></div>
      <div class="row"><span class="label">Membership No.</span><span class="value">${member?.membershipNumber || "—"}</span></div>
      <div class="row"><span class="label">Bill Period</span><span class="value">${receipt.billPeriodId}</span></div>
      <div class="row"><span class="label">Payment Mode</span><span class="value">${receipt.paymentMode}</span></div>
      <div class="row"><span class="label">Transaction ID</span><span class="value" style="font-family: monospace; font-size: 12px;">${receipt.transactionId}</span></div>

     
           ${
             allChargeRows.length > 0
               ? `
      <div class="charges-section">
        <div class="charges-title">Bill Breakdown</div>
        ${allChargeRows
          .map(
            ([name, amt]) => `
          <div class="charge-row">
            <span>${name}</span>
            <span style="font-weight:600">₹${parseFloat(amt).toLocaleString("en-IN")}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    `
               : ""
           }

      <div class="total-box">
        <div class="total-label">Amount Paid</div>
        <div class="total-amount">₹${receipt.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
      </div>
    </div>
    <div class="footer">
      ${society?.name} | ${society?.address || ""}<br/>
      Generated on ${new Date().toLocaleString("en-IN")} | Computer Generated Receipt
    </div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); }</script>
</body>
</html>`;
}
