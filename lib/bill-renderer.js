import {
  getOldestDueDate,
  calculateMonthlyInterest,
} from "../utils/interestUtils";
export default function renderBillHtml(
  templateHtml,
  societyParam,
  memberParam,
  data,
) {
  const society = data.society || societyParam || {};
  const member = data.member || memberParam || {};
  const config = society.config || {};
  const interestRate = config.interestRate || 21;
  const gracePeriod = config.interestAfterDays ?? config.gracePeriodDays ?? 10;
  const interestAfterDays = config.interestAfterDays;
  const interestMethod = config.interestCalculationMethod || "SIMPLE";
  const serviceTaxRate = config.serviceTaxRate || 0;
  const previousBillHtml = data.previousBillHtml || null;

  // ✅ Use Date objects, not formatted strings
  const billDate =
    data.billDate instanceof Date ? data.billDate : new Date(data.billDate);
  const dueDate =
    data.dueDate instanceof Date ? data.dueDate : new Date(data.dueDate);

  const formatDate = (d) =>
    new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  // Interest calculation — use central utility (same as bill generation, never diverges)

  let interestAmount = 0;
  let currInt = 0;
  let monthInterest = 0;
  let interestDays = 0;

  // Interest on principal only — never on total balance (no interest-on-interest).
  // prevRemPrincipal is the sum of unpaid bill principalBalances (or member.openingPrincipal for first bill).
  const principalForInterest = data.prevRemPrincipal ?? data.previousBalance ?? 0;
  const remIntFromPrior = data.prevRemInt ?? 0;
  if (principalForInterest > 0 || remIntFromPrior > 0) {
    // Use unpaid bills from data if available, else fallback
    const unpaidForInterest = data.unpaidBills?.length
      ? data.unpaidBills.map((b) => ({
          dueDate: b.dueDate,
          billYear: b.billYear,
          billMonth: b.billMonth,
        }))
      : [];
    const oldestDueDate = getOldestDueDate(
      unpaidForInterest,
      config.billDueDay || 10,
      billDate.getFullYear(),
      billDate.getMonth() + 1,
    );
    ({ currInt, monthInterest } = calculateMonthlyInterest({
      remainingPrincipal: principalForInterest,
      remInt: remIntFromPrior,
      annualRate: interestRate,
      gracePeriodDays: gracePeriod,
      interestAfterDays,
      billDueDate: oldestDueDate,
      referenceDate: billDate,
      interestRounding: config.interestRounding || "TWO_DECIMAL",
      interestTriggerTiming: config.interestTriggerTiming || "NEXT_DAY",
    }));
    interestAmount = monthInterest;
  }

  const breakdown = data.breakdown || {};
  const chargeRows = Object.entries(breakdown)
    .map(
      ([desc, amt], idx) => `
    <tr style="background:${idx % 2 === 0 ? "#ffffff" : "#f9fafb"}">
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">${idx + 1}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:500;color:#1f2937;">${desc}</td>
      <td style="padding:10px 14px;text-align:right;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111827;">₹${parseFloat(amt).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
    </tr>`,
    )
    .join("");

  const subtotal = Object.values(breakdown).reduce(
    (s, v) => s + parseFloat(v),
    0,
  );
  const serviceTax =
    serviceTaxRate > 0 ? +((subtotal * serviceTaxRate) / 100).toFixed(2) : 0;
  const currentBillTotal = +(subtotal + serviceTax).toFixed(2);
  // previousBalance already contains carried interest (openingInterest).
  // Only add currInt (new this month) to avoid double-counting.
  const totalPayable = +(
    (data.previousBalance || 0) +
    currInt +
    currentBillTotal
  ).toFixed(2);

  // Unpaid bills table (page 2)
  const unpaidBillsHtml =
    (data.unpaidBills || []).length > 0
      ? `
    <div style="margin-bottom:28px;">
      <h3 style="margin:0 0 12px 0;font-size:15px;color:#991b1b;font-weight:700;">📋 Outstanding Bills Detail</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#fca5a5;color:#7f1d1d;">
            <th style="padding:9px 12px;border:1px solid #fca5a5;text-align:left;">Bill Period</th>
            <th style="padding:9px 12px;border:1px solid #fca5a5;text-align:right;">Bill Amount</th>
            <th style="padding:9px 12px;border:1px solid #fca5a5;text-align:right;">Paid</th>
            <th style="padding:9px 12px;border:1px solid #fca5a5;text-align:right;">Balance Due</th>
            <th style="padding:9px 12px;border:1px solid #fca5a5;text-align:center;">Due Date</th>
            <th style="padding:9px 12px;border:1px solid #fca5a5;text-align:center;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${(data.unpaidBills || [])
            .map(
              (b, i) => `
            <tr style="background:${i % 2 === 0 ? "#fff" : "#fff5f5"}">
              <td style="padding:8px 12px;border-bottom:1px solid #fecaca;">${b.billPeriodId || b.period || "-"}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fecaca;text-align:right;">₹${parseFloat(b.totalAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fecaca;text-align:right;">₹${parseFloat(b.amountPaid || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fecaca;text-align:right;color:#dc2626;font-weight:700;">₹${parseFloat(b.balanceAmount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fecaca;text-align:center;">${b.dueDate ? formatDate(b.dueDate) : "-"}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #fecaca;text-align:center;">
                <span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">${b.status || "Unpaid"}</span>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`
      : `<div style="background:#d1fae5;border-radius:8px;padding:20px;text-align:center;color:#065f46;font-weight:600;margin-bottom:28px;">
          ✅ No outstanding bills. Account is clear!
        </div>`;

  // Recent transactions (page 2)
  const recentTxHtml =
    (data.recentTransactions || []).length > 0
      ? `
    <div>
      <h3 style="margin:0 0 12px 0;font-size:15px;color:#1e40af;font-weight:700;">🏦 Recent Payment History (Last 10)</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#dbeafe;color:#1e40af;">
            <th style="padding:9px 12px;border:1px solid #bfdbfe;text-align:left;">Date</th>
            <th style="padding:9px 12px;border:1px solid #bfdbfe;text-align:left;">Description</th>
            <th style="padding:9px 12px;border:1px solid #bfdbfe;text-align:center;">Type</th>
            <th style="padding:9px 12px;border:1px solid #bfdbfe;text-align:right;">Amount</th>
            <th style="padding:9px 12px;border:1px solid #bfdbfe;text-align:right;">Balance After</th>
          </tr>
        </thead>
        <tbody>
          ${(data.recentTransactions || [])
            .slice(0, 10)
            .map(
              (tx, i) => `
            <tr style="background:${i % 2 === 0 ? "#ffffff" : "#eff6ff"}">
              <td style="padding:8px 12px;border-bottom:1px solid #bfdbfe;">${tx.date ? formatDate(tx.date) : "-"}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #bfdbfe;">${tx.description || tx.category || "-"}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #bfdbfe;text-align:center;">
                <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${tx.type === "Credit" ? "#d1fae5" : "#fee2e2"};color:${tx.type === "Credit" ? "#065f46" : "#991b1b"}">${tx.type}</span>
              </td>
              <td style="padding:8px 12px;border-bottom:1px solid #bfdbfe;text-align:right;color:${tx.type === "Credit" ? "#059669" : "#dc2626"};font-weight:600;">₹${parseFloat(tx.amount || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #bfdbfe;text-align:right;">₹${parseFloat(tx.balanceAfterTransaction || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`
      : "";

  const html = `
<div style="max-width:800px;margin:0 auto;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;">

  <!-- ═══════════════════ PAGE 1: CURRENT BILL ═══════════════════ -->
  <div style="padding:40px;background:white;page-break-after:always;">

    <!-- Society Header -->
    <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:white;padding:28px 32px;border-radius:10px;margin-bottom:24px;">
      <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;">${society.name || "Society"}</h1>
      <p style="margin:0;font-size:12px;opacity:0.85;">${society.address || ""}</p>
    </div>

    <!-- Bill Title Row -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e5e7eb;">
      <h2 style="margin:0;font-size:20px;font-weight:700;letter-spacing:1px;color:#1e40af;">MAINTENANCE BILL</h2>
      <div style="text-align:right;font-size:12px;color:#6b7280;line-height:1.8;">
        <div>Bill No: <strong style="color:#1f2937;">${data.billPeriod}-${member.flatNo || ""}</strong></div>
        <div>Date: <strong style="color:#1f2937;">${formatDate(billDate)}</strong></div>
        <div>Due: <strong style="color:#dc2626;">${formatDate(dueDate)}</strong></div>
      </div>
    </div>

    <!-- Member Info Grid -->
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;font-size:13px;">
      <div><span style="color:#6b7280;">Bill Period:</span> <strong>${data.billPeriod}</strong></div>
      <div><span style="color:#6b7280;">Flat:</span> <strong>${member.wing || ""}-${member.flatNo || ""}</strong></div>
      <div><span style="color:#6b7280;">Owner Name:</span> <strong>${member.ownerName || ""}</strong></div>
      <div><span style="color:#6b7280;">Carpet Area:</span> <strong>${member.carpetAreaSqft || 0} sq ft</strong></div>
      <div><span style="color:#6b7280;">Contact:</span> <strong>${member.contactNumber || "-"}</strong></div>
      <div><span style="color:#6b7280;">Due Date:</span> <strong style="color:#dc2626;">${formatDate(dueDate)}</strong></div>
    </div>

    <!-- ⚠️ Previous Outstanding (shown only if exists) -->
    ${
      (data.previousBalance || 0) > 0
        ? `
    <div style="background:#fee2e2;border:1px solid #fca5a5;border-left:5px solid #dc2626;padding:20px 24px;border-radius:8px;margin-bottom:20px;">
      <h3 style="margin:0 0 16px 0;color:#991b1b;font-size:15px;font-weight:700;">⚠️ Previous Outstanding Balance</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;text-align:center;">
        <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:#7f1d1d;margin-bottom:6px;font-weight:600;text-transform:uppercase;">Total Outstanding</div>
          <div style="font-size:22px;font-weight:700;color:#dc2626;">₹${(data.previousBalance || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
        <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:#7f1d1d;margin-bottom:6px;font-weight:600;text-transform:uppercase;">Days Overdue</div>
          <div style="font-size:22px;font-weight:700;color:${interestDays > 0 ? "#dc2626" : "#059669"};">${interestDays > 0 ? interestDays + " days" : "Within grace"}</div>
        </div>
        <div style="background:rgba(255,255,255,0.6);border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:#7f1d1d;margin-bottom:6px;font-weight:600;text-transform:uppercase;">Interest Charged</div>
          <div style="font-size:22px;font-weight:700;color:#dc2626;">₹${interestAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
        </div>
      </div>
      <div style="background:rgba(255,255,255,0.5);border-radius:6px;padding:12px 16px;font-size:12px;color:#7f1d1d;line-height:1.7;">
        <strong>Interest Calculation:</strong> ₹${principalForInterest.toLocaleString("en-IN")} × ${interestRate}% p.a. ÷ 12
        ${
          currInt > 0
            ? ` = <strong>₹${currInt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong> new` + (remIntFromPrior > 0 ? ` + ₹${remIntFromPrior.toLocaleString("en-IN", { minimumFractionDigits: 2 })} carried = <strong>₹${interestAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>` : "")
            : ` — within ${gracePeriod}-day grace period` + (remIntFromPrior > 0 ? ` (carried: ₹${remIntFromPrior.toLocaleString("en-IN", { minimumFractionDigits: 2 })})` : " (no interest charged)")
        }
        <br/>Grace Period: <strong>${gracePeriod} days</strong> &nbsp;|&nbsp; See Page 2 for full account statement.
      </div>
    </div>`
        : `
    <div style="background:#d1fae5;border:1px solid #6ee7b7;border-left:5px solid #10b981;padding:14px 20px;border-radius:8px;margin-bottom:20px;font-size:13px;color:#065f46;font-weight:600;">
      ✅ No previous outstanding balance. Account is clear!
    </div>`
    }

    <!-- Current Month Charges -->
    <h3 style="margin:0 0 14px 0;font-size:15px;color:#374151;font-weight:700;">Current Month Charges — ${data.billPeriod}</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background:#1e40af;color:white;">
                    <th style="padding:12px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Sr.</th>
          <th style="padding:12px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Particulars</th>
          <th style="padding:12px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${chargeRows}
        ${
          serviceTax > 0
            ? `<tr style="background:#f9fafb;"><td colspan="2" style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;font-size:13px;">Service Tax (${serviceTaxRate}%)</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">₹${serviceTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>`
            : ""
        }
              <tr style="background:#dbeafe;">
          <td colspan="2" style="padding:13px 14px;text-align:right;color:#1e40af;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:0.4px;">Current Bill Total</td>
          <td style="padding:13px 14px;text-align:right;color:#1e40af;font-weight:800;font-size:16px;">₹${currentBillTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>

    <!-- Bill Summary Breakdown -->
    ${
      (data.previousBalance || 0) > 0
        ? `
    <div style="background:#f3f4f6;border-radius:8px;padding:16px 20px;margin-bottom:20px;font-size:13px;">
      <div style="font-weight:700;color:#374151;margin-bottom:12px;">Bill Calculation Summary</div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;">Previous Outstanding</span><span>₹${(data.previousBalance || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;">Interest on Arrears (${interestRate}% p.a.)</span><span style="color:#dc2626;">+ ₹${interestAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;">Current Month Bill</span><span>+ ₹${currentBillTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700;font-size:14px;color:#1e40af;"><span>TOTAL PAYABLE</span><span>₹${totalPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
    </div>`
        : ""
    }

    <!-- Grand Total Box -->
    <div style="background:linear-gradient(135deg,#1e3a8a,#1e40af);color:white;padding:24px 32px;border-radius:10px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;opacity:0.9;">Total Amount Payable</div>          <div style="font-size:12px;opacity:0.8;">Please pay by <strong>${formatDate(dueDate)}</strong> to avoid additional interest</div>
        </div>
        <div style="font-size:32px;font-weight:800;letter-spacing:-0.5px;">₹${totalPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>      </div>
    </div>

    <!-- Payment Instructions -->
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:18px 22px;margin-bottom:20px;font-size:12px;color:#6b7280;">
      <strong style="color:#374151;display:block;margin-bottom:10px;">Payment Instructions:</strong>
      <ol style="margin:0;padding-left:18px;line-height:2;">
        <li>Please pay on or before <strong style="color:#dc2626;">${formatDate(dueDate)}</strong> to avoid interest charges.</li>
        <li>Interest @ ${interestRate}% p.a. (${interestMethod}) is charged after ${gracePeriod}-day grace period.</li>
        <li>For payment queries or discrepancies, contact the society office.</li>
        <li>This is a computer-generated bill. No signature required.</li>
      </ol>
    </div>

    <div style="text-align:center;font-size:11px;color:#9ca3af;padding-top:14px;border-top:1px solid #e5e7eb;">
      Generated on ${new Date().toLocaleString("en-IN")} &nbsp;|&nbsp; Computer Generated Bill &nbsp;|&nbsp; Page 1 of 2
    </div>
  </div>

  <!-- ═══════════════════ PAGE 2: ACCOUNT STATEMENT ═══════════════════ -->
  <div style="padding:40px;background:white;border-top:4px solid #1e40af;margin-top:4px;">

    <!-- Page 2 Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e5e7eb;">
      <div>
        <h2 style="margin:0 0 4px 0;font-size:20px;font-weight:700;color:#1e40af;">Account Statement</h2>
        <p style="margin:0;font-size:13px;color:#6b7280;">${society.name || ""} — ${member.wing || ""}-${member.flatNo || ""} — ${member.ownerName || ""}</p>
      </div>
      <div style="text-align:right;font-size:12px;color:#6b7280;line-height:1.8;">
        <div>Period: <strong>${data.billPeriod}</strong></div>
        <div>Flat: <strong>${member.wing || ""}-${member.flatNo || ""}</strong></div>
        <div>Generated: <strong>${formatDate(new Date())}</strong></div>
      </div>
    </div>

    <!-- Account Summary Cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px;">
      <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#1e40af;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Current Bill</div>
        <div style="font-size:20px;font-weight:700;color:#1e40af;">₹${currentBillTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
      </div>
      <div style="background:${(data.previousBalance || 0) > 0 ? "#fee2e2" : "#d1fae5"};border:1px solid ${(data.previousBalance || 0) > 0 ? "#fca5a5" : "#6ee7b7"};border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:${(data.previousBalance || 0) > 0 ? "#7f1d1d" : "#065f46"};font-weight:700;text-transform:uppercase;margin-bottom:6px;">Prev Balance</div>
        <div style="font-size:20px;font-weight:700;color:${(data.previousBalance || 0) > 0 ? "#dc2626" : "#059669"};">
          ${(data.previousBalance || 0) > 0 ? `₹${(data.previousBalance || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })} DR` : "₹0.00 Clear"}
        </div>
      </div>
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Interest</div>
        <div style="font-size:20px;font-weight:700;color:${interestAmount > 0 ? "#dc2626" : "#059669"};">
          ${interestAmount > 0 ? `₹${interestAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "₹0.00"}
        </div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:11px;color:#14532d;font-weight:700;text-transform:uppercase;margin-bottom:6px;">Total Payable</div>
        <div style="font-size:20px;font-weight:700;color:#1e40af;">₹${totalPayable.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
      </div>
    </div>

    <!-- Interest Calculation Detail (if applicable) -->
    ${
      (data.previousBalance || 0) > 0
        ? `
    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:20px 24px;margin-bottom:28px;">
      <h3 style="margin:0 0 16px 0;font-size:15px;color:#92400e;font-weight:700;">📐 Interest Calculation Detail</h3>
      <table style="width:100%;font-size:13px;border-collapse:collapse;">
        <tr><td style="padding:7px 12px;color:#6b7280;width:45%;">Principal (Chargeable Balance)</td><td style="padding:7px 12px;font-weight:600;">₹${principalForInterest.toLocaleString("en-IN", { minimumFractionDigits: 2 })}${remIntFromPrior > 0 ? ` <span style="font-size:11px;color:#6b7280;">(+ ₹${remIntFromPrior.toLocaleString("en-IN", { minimumFractionDigits: 2 })} carried interest)</span>` : ""}</td></tr>
        <tr style="background:rgba(0,0,0,0.03)"><td style="padding:7px 12px;color:#6b7280;">Annual Interest Rate</td><td style="padding:7px 12px;font-weight:600;">${interestRate}% per annum</td></tr>
        <tr><td style="padding:7px 12px;color:#6b7280;">Calculation Method</td><td style="padding:7px 12px;font-weight:600;">${interestMethod}</td></tr>
        <tr style="background:rgba(0,0,0,0.03)"><td style="padding:7px 12px;color:#6b7280;">Grace Period (Interest After)</td><td style="padding:7px 12px;font-weight:600;">${gracePeriod} days</td></tr>
    <tr><td style="padding:7px 12px;color:#6b7280;">Calculation Basis</td>
<td style="padding:7px 12px;font-weight:600;">Monthly (Indian Standard — 1 day late = 1 full month)</td></tr>

<tr style="background:rgba(0,0,0,0.03)"><td style="padding:7px 12px;color:#6b7280;">Days Overdue (after grace)</td>
<td style="padding:7px 12px;font-weight:600;">${interestDays} days</td></tr>

<tr style="background:rgba(0,0,0,0.03)">
  <td style="padding:7px 12px;color:#6b7280;">Formula Applied</td>
  <td style="padding:7px 12px;font-family:monospace;font-size:12px;">
    ₹${(principalForInterest || 0).toLocaleString("en-IN")} × ${interestRate} ÷ 1200
    = <strong>₹${currInt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong>/month
  </td>
</tr>
${
  remIntFromPrior > 0
    ? `
<tr>
  <td style="padding:7px 12px;color:#6b7280;">Carried-Forward Interest</td>
  <td style="padding:7px 12px;font-weight:600;">
    + ₹${remIntFromPrior.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
  </td>
</tr>`
    : ""
}

<tr style="background:#fde68a;"><td style="padding:9px 12px;font-weight:700;color:#92400e;">Interest Amount Charged</td>
<td style="padding:9px 12px;font-weight:700;font-size:15px;color:#92400e;">₹${interestAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
      </table>
    </div>`
        : ""
    }

    <!-- Outstanding Bills Detail -->
    ${unpaidBillsHtml}

    <!-- Recent Payment History -->
    ${recentTxHtml}

    <!-- Page 2 Footer -->
    <div style="text-align:center;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;margin-top:28px;">
      ${society.name || ""} &nbsp;|&nbsp; ${society.address || ""} &nbsp;|&nbsp; Page 2 of 2 &nbsp;|&nbsp; Computer Generated Bill
    </div>
  </div>

</div>`;

  // ✅ Return object so caller can access interestAmount
  // Append previous bill as Page 3 if provided
  // Append previous bill as Page 3 if provided (only once)
  if (previousBillHtml) {
    html += `
      <div style="page-break-before:always; padding:40px; background:#fff;">
        <div style="border-bottom:2px solid #e5e7eb; padding-bottom:12px; margin-bottom:24px;">
          <h2 style="margin:0; font-size:16px; color:#6b7280;">📎 Previous Month's Bill (Reference Copy)</h2>
        </div>
        ${previousBillHtml}
      </div>`;
  }
  return {
    html,
    billHtml: html,
    currInt,
    monthInterest,
    interestAmount: monthInterest,
    interestDays,
  };
}
