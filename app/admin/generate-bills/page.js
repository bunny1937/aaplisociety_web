"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/GenerateBills.module.css";
import ExcelPreviewGrid from "@/components/ExcelPreviewGrid";

export default function GenerateBillsPage() {
  const queryClient = useQueryClient();

  const NOW = new Date();
  const CUR_MONTH = NOW.getMonth(); // actual current month for disabling past options
  const CUR_YEAR = NOW.getFullYear();
  const _nextMonth = new Date();
  _nextMonth.setMonth(_nextMonth.getMonth() + 1); // handles Dec→Jan rollover automatically
  const [billMonth, setBillMonth] = useState(_nextMonth.getMonth()); // 0-indexed: May = 4
  const [billYear, setBillYear] = useState(_nextMonth.getFullYear()); // bumps year if Dec→Jan
  const [dueDate, setDueDate] = useState("");

  // ── Dynamic Billing Run Config (per-run overrides, not persisted) ──────────
  const [billDueDay, setBillDueDay] = useState(10);
  const [gracePeriodDays, setGracePeriodDays] = useState(0);
  const [billPayFinalDay, setBillPayFinalDay] = useState(0);
  const [billVisibleFromDay, setBillVisibleFromDay] = useState(1);

  // ── Member Selector State ──────────────────────────────────────────────────
  const [memberSearch, setMemberSearch] = useState("");
  const [wingFilter, setWingFilter] = useState("all");
  const [selectorOpen, setSelectorOpen] = useState(true);
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set());

  // ── Flow 1: Bill Generation ────────────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const [excelFile, setExcelFile] = useState(null);
  const [excelValidation, setExcelValidation] = useState(null);
  const [excelValidating, setExcelValidating] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewProgress, setPreviewProgress] = useState({ current: 0, total: 0 });
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });
  const [excelImporting, setExcelImporting] = useState(false);
  const [approvedDiffs, setApprovedDiffs] = useState(new Set());

  // ── Bill Generation Mode ───────────────────────────────────────────────────
  const [billGenerationMode, setBillGenerationMode] = useState("MANUAL");
  const [showAutoWarning, setShowAutoWarning] = useState(false);

  // ── Excel Preview Grids ────────────────────────────────────────────────────
  const [billGrid, setBillGrid] = useState(null);
  const [payGrid, setPayGrid] = useState(null);

  // ── Flow 2: Payment Collection ─────────────────────────────────────────────
  const [payFile, setPayFile] = useState(null);
  const [payPreviewing, setPayPreviewing] = useState(false);
  const [payPreview, setPayPreview] = useState(null);
  const [payBatchKey, setPayBatchKey] = useState(null);
  const [payConfirming, setPayConfirming] = useState(false);
  const [payResults, setPayResults] = useState(null);

  const diffIssues = excelValidation?.issues?.filter((i) => i.type === "diff") || [];
  const allDiffsApproved = diffIssues.length === 0 || diffIssues.every((d) => approvedDiffs.has(d.memberId));
  const canGenerate = !excelImporting && allDiffsApproved;
  // Set default due date based on billDueDay
  useEffect(() => {
    const nextMonth = new Date(billYear, billMonth + 1, billDueDay);
    setDueDate(nextMonth.toISOString().split("T")[0]);
  }, [billMonth, billYear, billDueDay]);

  // Populate billing config from society settings on first load
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  useEffect(() => {
    const cfg = societyData?.society?.config || {};
    if (cfg.billDueDay) setBillDueDay(parseInt(cfg.billDueDay) || 10);
    if (cfg.gracePeriodDays !== undefined) setGracePeriodDays(parseInt(cfg.gracePeriodDays) || 0);
    if (cfg.billPayFinalDay !== undefined) setBillPayFinalDay(parseInt(cfg.billPayFinalDay) || 0);
    if (cfg.billVisibleFromDay !== undefined) setBillVisibleFromDay(parseInt(cfg.billVisibleFromDay) || 1);
    if (cfg.billGenerationMode) setBillGenerationMode(cfg.billGenerationMode);
  }, [societyData]);

  const { data: membersData } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list"),
  });

  const { data: billingHeadsData } = useQuery({
    queryKey: ["billing-heads"],
    queryFn: () => apiClient.get("/api/billing-heads/list"),
  });

  const { data: templateData } = useQuery({
    queryKey: ["bill-template-full"],
    queryFn: () => apiClient.get("/api/bill-template/get-full"),
  });

  // ── Member Selector Logic ──────────────────────────────────────────────────
  const allMembers = membersData?.members || [];
  const wings = useMemo(
    () => ["all", ...Array.from(new Set(allMembers.map((m) => m.wing).filter(Boolean))).sort()],
    [allMembers],
  );
  const filteredMembers = useMemo(() => {
    const q = memberSearch.toLowerCase();
    return allMembers.filter((m) => {
      const matchWing = wingFilter === "all" || m.wing === wingFilter;
      const matchSearch = !q || (m.ownerName || "").toLowerCase().includes(q) || (m.flatNo || "").toLowerCase().includes(q) || (m.wing || "").toLowerCase().includes(q);
      return matchWing && matchSearch;
    });
  }, [allMembers, memberSearch, wingFilter]);

  const toggleMember = (id) =>
    setSelectedMemberIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const selectAll = () => setSelectedMemberIds(new Set(filteredMembers.map((m) => m._id)));
  const deselectAll = () => setSelectedMemberIds((prev) => { const next = new Set(prev); filteredMembers.forEach((m) => next.delete(m._id)); return next; });
  const selectedMemberIdsArray = Array.from(selectedMemberIds);
  const canDownload = selectedMemberIds.size > 0;
  const periodLabel = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;

  // Interest now calculated server-side via get-previous-balances which uses
  // centralised interestUtils. Client preview uses daysOverdue from server response.
  // This function kept for preview display only — actual saved interest comes from server.
  const calculateInterest = (
    principal,
    daysOverdue,
    rate,
    method,
    gracePeriod,
    interestBasis = "MONTHLY", // ← ADD THIS PARAM
  ) => {
    if (principal <= 0) return 0;
    const effectiveDays = Math.max(0, daysOverdue - gracePeriod);
    if (effectiveDays <= 0) return 0;
    const rateDecimal = rate / 100;

    if (interestBasis === "MONTHLY") {
      const chargeableMonths = Math.ceil(effectiveDays / 30);
      if (method === "SIMPLE") {
        return principal * (rateDecimal / 12) * chargeableMonths;
      } else {
        return (
          principal * (Math.pow(1 + rateDecimal / 12, chargeableMonths) - 1)
        );
      }
    } else {
      // DAILY (legacy)
      if (method === "SIMPLE") {
        return (principal * rateDecimal * effectiveDays) / 365;
      } else {
        const t = effectiveDays / 365;
        return principal * (Math.pow(1 + rateDecimal / 12, 12 * t) - 1);
      }
    }
  };
  // Generate preview with FULL calculations
  const generatePreview = async () => {
    if (selectedMemberIds.size === 0) {
      alert("❌ Select at least one member before previewing.");
      return;
    }
    if (!dueDate) {
      alert("❌ Please select due date");
      return;
    }
    setIsPreviewing(true);
    setPreviewProgress({ current: 0, total: selectedMemberIds.size });
    await new Promise((r) => setTimeout(r, 50));
    setPreviewProgress({ current: 0, total: 0, label: "fetching" });
    await new Promise((r) => setTimeout(r, 50));

    try {
      const society = societyData?.society || {};
      const config = society.config || {};
      const members = allMembers.filter((m) => selectedMemberIds.has(m._id));
      const heads = billingHeadsData?.heads || [];

      // Per-member parking charges — only for their actual slots
      const parkingRates = society?.config?.parkingRates ?? {
        "Open-Two-Wheeler": 100,
        "Open-Four-Wheeler": 150,
        "Covered-Two-Wheeler": 200,
        "Covered-Four-Wheeler": 300,
      };
      // const parkingCharges = (members.parkingSlots ?? [])
      //   .filter((s) => s.monthlyBilling !== false && s.type !== "Stilt")
      //   .reduce((sum, slot) => {
      //     const key = `${slot.type}-${slot.vehicleType}`;
      //     return sum + (parkingRates[key] ?? 0);
      //   }, 0);
      // Interest config
      const interestRate = parseFloat(config.interestRate) || 0;
      const interestMethod = config.interestCalculationMethod || "SIMPLE";
      // billPayFinalDay is enforced server-side in get-previous-balances
      // daysOverdue returned from server already respects that cap
      const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;

      // Fetch previous balances for all members
      // Build ISO string as local midnight to avoid IST→UTC date shift.
      // new Date(y, m, 1).toISOString() in IST gives "April 30T18:30Z" for May 1 IST.
      // Padding manually keeps the server on the correct billing month.
      const _billingMonthStr = `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`;
      const previousBalancesResponse = await apiClient.post(
        "/api/bills/get-previous-balances",
        {
          memberIds: members.map((m) => m._id).filter(Boolean),
          billMonth: billMonth + 1,
          billYear,
          billDate: _billingMonthStr,
        },
      );

      const previousBalances = previousBalancesResponse.balances || {};
      const total = members.length;
      setPreviewProgress({ current: 0, total, label: "calculating" });
      await new Promise((r) => setTimeout(r, 0));

      const preview = [];
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        setPreviewProgress({ current: i + 1, total });

        const area = Number(
          member.carpetAreaSqft ??
            member.builtUpAreaSqft ??
            member.areaSqFt ??
            0,
        );
        const flatNo = member.roomNo || member.flatNo || "";
        const memberId = member._id;

        const prevData = previousBalances[memberId] || {
          balance: 0,
          daysOverdue: 0,
          lastBillDate: null,
        };

        const interestBasis = config.interestBasis || "MONTHLY"; // ← add this above loop
        // Interest must be on principal only — never on total balance (principal + interest)
        const interestAmount = calculateInterest(
          prevData.principalBalance ?? prevData.balance,
          prevData.daysOverdue,
          interestRate,
          interestMethod,
          gracePeriodDays,
          interestBasis, // ← pass it
        );

        const memberParkingSlots = (member.parkingSlots ?? []).filter(
          (s) => s.monthlyBilling !== false && s.type !== "Stilt",
        );

        const charges = [];
        (heads ?? []).forEach((head) => {
          if (!head.headName?.trim() || head.isActive === false) return;
          const headLower = head.headName.trim().toLowerCase();
          const isParkingHead =
            headLower.includes("parking") ||
            headLower.includes("two-wheeler") ||
            headLower.includes("four-wheeler") ||
            headLower.includes("two wheeler") ||
            headLower.includes("four wheeler");
          if (isParkingHead) return;
          const rate = parseFloat(head.defaultAmount) || 0;
          if (head.calculationType === "Per Sq Ft") {
            charges.push({
              name: head.headName,
              rate,
              calculation: `${area} × ${rate}`,
              perSqFt: true,
              amount: area * rate,
            });
          } else if (head.calculationType === "Percentage") {
            const base = charges.reduce((s, c) => s + c.amount, 0);
            charges.push({
              name: head.headName,
              fixed: true,
              amount: base * (rate / 100),
            });
          } else {
            charges.push({ name: head.headName, fixed: true, amount: rate });
          }
        });

        memberParkingSlots.forEach((slot) => {
          const key = `${slot.type}-${slot.vehicleType}`;
          const amount = parkingRates[key] ?? 0;
          if (amount > 0) {
            charges.push({
              name: `${slot.type} Parking - ${slot.vehicleType} (${slot.slotNumber})`,
              fixed: true,
              amount,
            });
          }
        });

        const memberParkingCharges = memberParkingSlots.reduce(
          (sum, slot) =>
            sum + (parkingRates[`${slot.type}-${slot.vehicleType}`] ?? 0),
          0,
        );

        const activeCharges = charges.filter(
          (c) => c.amount !== null && c.amount !== undefined,
        );
        const subtotal = activeCharges.reduce((sum, c) => sum + c.amount, 0);
        const serviceTax =
          serviceTaxRate > 0 ? (subtotal * serviceTaxRate) / 100 : 0;
        const currentBillTotal = subtotal + serviceTax;
        const grandTotal = prevData.balance + interestAmount + currentBillTotal;
        const grandTotalRounded = Math.round(grandTotal * 100) / 100;

        preview.push({
          memberId,
          member: `${member.wing || ""}-${flatNo}`,
          memberName: member.ownerName || "Unknown",
          memberContact: member.contact || "",
          area,
          parkingCharges: memberParkingCharges,
          previousBalance: prevData.balance || 0,
          previousBalanceDays: prevData.daysOverdue || 0,
          lastBillDate: prevData.oldestUnpaidDate,
          unpaidBills: prevData.unpaidBills || [],
          recentTransactions: prevData.recentTransactions || [],
          interestRate,
          interestMethod,
          gracePeriodDays,
          interestAmount: Math.round(interestAmount * 100) / 100,
          charges: activeCharges,
          subtotal,
          serviceTax,
          serviceTaxRate,
          currentBillTotal,
          grandTotal: grandTotalRounded,
        });

        // Yield to React to actually re-render the counter
        await new Promise((r) => setTimeout(r, 0));
      }

      const sortedPreview = [...preview].sort((a, b) => {
        const [wA, rA] = (a.member ?? "").split("-");
        const [wB, rB] = (b.member ?? "").split("-");
        const wingDiff = (wA ?? "").localeCompare(wB ?? "");
        if (wingDiff !== 0) return wingDiff;
        return Number(rA ?? 0) - Number(rB ?? 0);
      });
      setPreviewProgress({ current: 0, total: 0 });
      setPreviewData(sortedPreview);
      setPreviewIndex(0);
      setSelectedMemberIds(new Set(sortedPreview.map((row) => row.memberId)));
      setShowPreview(true);
    } catch (err) {
      alert("❌ Failed to build previews: " + err.message);
    } finally {
      setIsPreviewing(false);
      setPreviewProgress({ current: 0, total: 0 });
    }
  };

  // Confirm and generate bills

  const generateMutation = useMutation({
    mutationFn: async () => {
      const billsToSend = (previewData || []).filter((row) =>
        selectedMemberIds.has(row.memberId),
      );

      const total = billsToSend.length;
      setGenProgress({ current: 0, total });

      if (total === 0) {
        throw new Error("No members selected for bill generation");
      }

      const result = await apiClient.post("/api/bills/generate-final", {
        billMonth,
        billYear,
        dueDate,
        bills: billsToSend.map((b) => ({
          memberId: b.memberId,
          totalAmount: b.grandTotal,
          previousBalance: b.previousBalance || 0,
          interestAmount: b.interestAmount || 0,
          subtotal: b.subtotal || 0,
          serviceTax: b.serviceTax || 0,
          currentBillTotal: b.currentBillTotal || 0,
          breakdown: Object.fromEntries(
            b.charges.map((c) => [c.name, c.amount]),
          ),
          unpaidBills: b.unpaidBills,
          recentTransactions: b.recentTransactions,
        })),
      });
      setGenProgress({ current: total, total });
      return { count: result.billsGenerated ?? result.count ?? 0 };
    },
    onSuccess: (data) => {
      setGenProgress({ current: 0, total: 0 });
      alert(`Generated ${data.count} bills successfully!`);
      setShowPreview(false);
      queryClient.invalidateQueries(["bills-list"]);
    },
    onError: (error) => {
      alert("Failed to generate bills: " + error.message);
    },
  });

  // Render bill HTML
  const renderBillHTML = (billData) => {
    const template = templateData?.template;

    // If uploaded PDF exists, show PDF preview
    if (template?.type === "uploaded-pdf" && template?.pdfUrl) {
      const hasFormFields = template.hasFormFields || false;
      const fieldCount = template.detectedFields?.length || 0;

      return `
    <div style="text-align: center;">
      <div style="background: #f9fafb; padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
        <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #374151;">
          <strong>📄 Bill will be generated using your uploaded PDF template</strong>
        </p>
        <p style="margin: 0; font-size: 0.95rem; color: #6b7280;">
          ${
            hasFormFields
              ? `✅ Auto-detected ${fieldCount} fillable fields`
              : "ℹ️ Data will be overlaid on PDF"
          }
        </p>
      </div>

      <!-- Show data that will be filled -->
      <div style="background: white; padding: 2rem; border-radius: 8px; border: 2px solid #e5e7eb; text-align: left;">
        <h3 style="margin: 0 0 1.5rem 0; color: #1f2937; border-bottom: 2px solid #4f46e5; padding-bottom: 0.75rem;">
          Data to be filled in PDF:
        </h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Member Name</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billData.memberName}</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Flat No</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billData.member}</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Area</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billData.area} sq ft</div>
          </div>
          <div>
            <div style="font-size: 0.875rem; color: #6b7280; margin-bottom: 0.25rem;">Bill Period</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #1f2937;">${billYear}-${String(billMonth + 1).padStart(2, "0")}</div>
          </div>
        </div>

        <h4 style="margin: 0 0 1rem 0; color: #374151; font-size: 1rem;">Current Month Charges:</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 1.5rem;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 0.75rem; text-align: left; border: 1px solid #e5e7eb; font-size: 0.875rem;">Sr.</th>
              <th style="padding: 0.75rem; text-align: left; border: 1px solid #e5e7eb; font-size: 0.875rem;">Particulars</th>
              <th style="padding: 0.75rem; text-align: right; border: 1px solid #e5e7eb; font-size: 0.875rem;">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${billData.charges
              .map(
                (charge, idx) => `
              <tr style="background: ${idx % 2 === 0 ? "#ffffff" : "#f9fafb"};">
                <td style="padding: 0.75rem; border: 1px solid #e5e7eb;">${idx + 1}</td>
                <td style="padding: 0.75rem; border: 1px solid #e5e7eb;">${charge.name}</td>
                <td style="padding: 0.75rem; text-align: right; border: 1px solid #e5e7eb; font-weight: 600;">
                  ${charge.amount.toFixed(2)}
                </td>
              </tr>
            `,
              )
              .join("")}
            <tr style="background: #dbeafe; font-weight: 700;">
              <td colspan="2" style="padding: 1rem; text-align: right; border: 1px solid #e5e7eb; color: #1e40af;">
                Current Month Total
              </td>
              <td style="padding: 1rem; text-align: right; border: 1px solid #e5e7eb; color: #1e40af; font-size: 1.2rem;">
                ₹${billData.currentBillTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>

        <!-- PREVIOUS BALANCE MOVED HERE - AFTER CHARGES -->
        ${
          Math.abs(billData.previousBalance) > 0
            ? `
          <div style="background: ${billData.previousBalance > 0 ? "#fee2e2" : "#d1fae5"}; border-left: 4px solid ${billData.previousBalance > 0 ? "#dc2626" : "#059669"}; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: ${billData.previousBalance > 0 ? "#991b1b" : "#065f46"};">
              ${billData.previousBalance > 0 ? "⚠️ Previous Outstanding Balance" : "✅  Opening Balance Credit"}
            </h4>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? "#7f1d1d" : "#065f46"}; margin-bottom: 0.5rem;">
                  ${billData.previousBalance > 0 ? "Amount Owed" : "Credit Adjustment"}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? "#dc2626" : "#059669"};">
                  ₹${Math.abs(billData.previousBalance).toLocaleString("en-IN")}
                </div>
              </div>
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? "#7f1d1d" : "#065f46"}; margin-bottom: 0.5rem;">
                  Days ${billData.previousBalance > 0 ? "Overdue" : "in Credit"}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? "#dc2626" : "#059669"};">
                  ${billData.previousBalanceDays} days
                </div>
              </div>
            </div>

            ${
              billData.interestAmount > 0
                ? `
              <div style="background: #7f1d1d; color: white; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                  <div style="font-size: 0.95rem; font-weight: 600;">💰 Interest Charged</div>
                  <div style="font-size: 1.5rem; font-weight: 700;">₹${billData.interestAmount.toLocaleString("en-IN")}</div>
                </div>
                <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                  Rate: ${billData.interestRate}% p.a. (${billData.interestMethod})<br/>
                  Grace: ${billData.gracePeriodDays} days | Overdue: ${billData.previousBalanceDays} days<br/>
Chargeable: ${Math.ceil(Math.max(0, billData.previousBalanceDays - billData.gracePeriodDays) / 30)} month(s) (${Math.max(0, billData.previousBalanceDays - billData.gracePeriodDays)} days)                </div>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }

        <!-- GRAND TOTAL -->
        <div style="background: #dbeafe; padding: 1.5rem; border-radius: 8px; border: 3px solid #1e40af; margin-bottom: 1rem;">
         <div style="display: flex; justify-content: space-between; align-items: center;">
  <div style="font-size: 1.2rem; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : "#1e40af"};">
    ${billData.grandTotal <= 0 ? "ADVANCE CREDIT BALANCE" : "TOTAL AMOUNT PAYABLE"}
  </div>
  <div style="font-size: 1.8rem; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : "#1e40af"};">
    ₹${Math.abs(billData.grandTotal).toFixed(2)}
  </div>
</div>
${
  billData.grandTotal <= 0
    ? `
  <div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: #d1fae5; border-radius: 6px; font-size: 0.8rem; color: #065f46;">
    No payment due. ₹${Math.abs(billData.grandTotal).toFixed(2)} credit will be adjusted in next bill.
  </div>
`
    : ""
}
          ${
            Math.abs(billData.previousBalance) > 0
              ? `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 2px solid #1e40af; font-size: 0.85rem; color: #1e40af;">
              ${billData.previousBalance > 0 ? `Previous Balance: ₹${billData.previousBalance.toFixed(2)}` : `Opening Credit: -₹${Math.abs(billData.previousBalance).toFixed(2)} (adjusting against current bill)`}
              ${billData.interestAmount > 0 ? ` + Interest: ₹${billData.interestAmount.toFixed(2)}` : ""}
              + Current: ₹${billData.currentBillTotal.toFixed(2)}
            </div>
          `
              : ""
          }
        </div>

        <div style="background: #f9fafb; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 0.875rem; color: #6b7280; text-align: center;">
            Click "Generate All Bills" to create PDF bills using your template
          </p>
        </div>
      </div>

      <!-- Show PDF Template Preview -->
      <div style="margin-top: 2rem; border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <div style="background: #1f2937; color: white; padding: 1rem; font-weight: 600;">
          📄 Your PDF Template (data will be filled here)
        </div>
        <iframe
          src="${template.pdfUrl}"
          style="width: 100%; height: 800px; border: none; background: white;"
        />
      </div>
    </div>
  `;
    }

    // If uploaded image
    if (template?.type === "uploaded-image" && template?.imageUrl) {
      return `
      <div style="text-align: center;">
        <div style="background: #f9fafb; padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
          <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #374151;">
            <strong>🖼️ Bill will be generated using your uploaded image template</strong>
          </p>
          <p style="margin: 0; font-size: 0.95rem; color: #6b7280;">
            Data will be overlaid on the image
          </p>
        </div>

        <!-- Show Image Template -->
        <div style="margin-top: 2rem; border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="background: #1f2937; color: white; padding: 1rem; font-weight: 600;">
            🖼️ Your Image Template (data will be overlaid)
          </div>
          <img src="${template.imageUrl}" style="width: 100%; height: auto;" />
        </div>
      </div>
    `;
    }

    // Otherwise use custom design template
    const society = societyData?.society || {};
    const design = template?.design || {
      headerBg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      headerColor: "#ffffff",
      societyNameSize: 28,
      addressSize: 14,
      billTitleSize: 22,
      billTitleAlign: "center",
      tableHeaderBg: "#4f46e5",
      tableHeaderColor: "#ffffff",
      tableRowBg1: "#ffffff",
      tableRowBg2: "#f9fafb",
      tableBorderColor: "#e5e7eb",
      totalBg: "#dbeafe",
      totalColor: "#1e40af",
      totalSize: 20,
      footerSize: 10,
      footerText: [
        "Payment should be made on or before due date",
        "Interest will be charged on overdue payments",
        "This is a computer-generated bill",
      ],
      showSignature: true,
      signatureLabel: "Authorized Signatory",
    };

    const logoUrl = template?.logoUrl || "";
    const signatureUrl = template?.signatureUrl || "";

    return `
    <div style="max-width: 800px; margin: 0 auto; padding: 40px; font-family: Arial, sans-serif; background: white; border: 1px solid #e5e7eb; border-radius: 8px;">
      <!-- Header -->
      <div style="background: ${design.headerBg}; color: ${design.headerColor}; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
        ${logoUrl ? `<img src="${logoUrl}" style="width: 80px; margin-bottom: 15px;" />` : ""}
        <h1 style="margin: 0; font-size: ${design.societyNameSize}px;">${society.name || "Society Name"}</h1>
        <p style="margin: 5px 0 0 0; font-size: ${design.addressSize}px; opacity: 0.9;">${society.address || ""}</p>
      </div>

      <!-- Bill Title -->
      <h2 style="text-align: ${design.billTitleAlign}; font-size: ${design.billTitleSize}px; margin: 0 0 20px 0; color: #1f2937;">
        MAINTENANCE BILL
      </h2>

      <!-- Bill Info -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
        <div><strong>Bill Period:</strong> ${billYear}-${String(billMonth + 1).padStart(2, "0")}</div>
<div><strong>Bill Date:</strong> ${new Date().toLocaleDateString("en-IN")}</div>      <div><strong>Member:</strong> ${billData.member}</div>
<div><strong>Due Date:</strong> ${new Date(dueDate + "T00:00:00").toLocaleDateString("en-IN")}</div>
        <div><strong>Name:</strong> ${billData.memberName}</div>
        <div><strong>Area:</strong> ${billData.area} sq ft</div>
      </div>

      <!-- Previous Balance Section - SAME AS ABOVE -->
${
  Math.abs(billData.previousBalance) > 0
    ? `
        <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 1rem 0; color: #991b1b;">⚠️ Previous Outstanding Balance</h4>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid #fca5a5;">
            <div>
              <div style="font-size: 0.875rem; color: #7f1d1d; margin-bottom: 0.5rem;">Total Outstanding</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #dc2626;">₹${billData.previousBalance.toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div style="font-size: 0.875rem; color: #7f1d1d; margin-bottom: 0.5rem;">${billData.previousBalance < 0 ? "Days in Credit" : "Days Overdue"}</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #dc2626;">${billData.previousBalanceDays || 0} days</div>
            </div>
          </div>

          ${
            billData.unpaidBills && billData.unpaidBills.length > 0
              ? `
            <div style="margin-bottom: 1.5rem;">
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: #7f1d1d; font-weight: 600;">📋 Unpaid Bills:</h5>
              <table style="width: 100%; font-size: 0.875rem; border-collapse: collapse;">
                <thead>
                  <tr style="background: #fca5a5;">
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid #dc2626; color: #7f1d1d;">Period</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Amount</th>
                    <th style="padding: 0.5rem; text-align: center; border: 1px solid #dc2626; color: #7f1d1d;">Due Date</th>
                    <th style="padding: 0.5rem; text-align: center; border: 1px solid #dc2626; color: #7f1d1d;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${billData.unpaidBills
                    .map(
                      (bill) => `
                    <tr style="background: white;">
                      <td style="padding: 0.5rem; border: 1px solid #fca5a5; font-weight: 600;">${bill.billPeriodId}</td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; font-weight: 600; color: #dc2626;">₹${bill.amount.toFixed(2)}</td>
                      <td style="padding: 0.5rem; text-align: center; border: 1px solid #fca5a5; font-size: 0.8rem;">${new Date(bill.dueDate).toLocaleDateString("en-IN")}</td>
                      <td style="padding: 0.5rem; text-align: center; border: 1px solid #fca5a5;">
                        <span style="background: #dc2626; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${bill.status}</span>
                      </td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
              : ""
          }

          ${
            billData.recentTransactions &&
            billData.recentTransactions.length > 0
              ? `
            <div style="margin-bottom: 1.5rem;">
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: #7f1d1d; font-weight: 600;">📊 Recent Transactions:</h5>
              <table style="width: 100%; font-size: 0.8rem; border-collapse: collapse;">
                <thead>
                  <tr style="background: #fca5a5;">
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid #dc2626; color: #7f1d1d;">Date</th>
                    <th style="padding: 0.5rem; text-align: left; border: 1px solid #dc2626; color: #7f1d1d;">Description</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Debit</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Credit</th>
                    <th style="padding: 0.5rem; text-align: right; border: 1px solid #dc2626; color: #7f1d1d;">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  ${billData.recentTransactions
                    .slice(0, 5)
                    .map(
                      (txn) => `
                    <tr style="background: white;">
                      <td style="padding: 0.5rem; border: 1px solid #fca5a5; font-size: 0.75rem;">${new Date(txn.date).toLocaleDateString("en-IN")}</td>
                      <td style="padding: 0.5rem; border: 1px solid #fca5a5;">
                        ${txn.description || txn.category}
                        ${txn.billPeriod ? `<br/><span style="font-size: 0.7rem; color: #7f1d1d;">(${txn.billPeriod})</span>` : ""}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; color: ${txn.type === "Debit" ? "#dc2626" : "#9ca3af"}; font-weight: ${txn.type === "Debit" ? "600" : "400"};">
                        ${txn.type === "Debit" ? "₹" + txn.amount.toFixed(2) : "-"}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; color: ${txn.type === "Credit" ? "#059669" : "#9ca3af"}; font-weight: ${txn.type === "Credit" ? "600" : "400"};">
                        ${txn.type === "Credit" ? "₹" + txn.amount.toFixed(2) : "-"}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; font-weight: 600; color: ${txn.balance >= 0 ? "#059669" : "#dc2626"};">
                        ₹${txn.balance.toFixed(2)}
                      </td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
              : ""
          }

          ${
            billData.interestAmount > 0
              ? `
            <div style="background: #7f1d1d; color: white; padding: 1rem; border-radius: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                <div style="font-size: 0.95rem; font-weight: 600;">💰 Interest Charged</div>
                <div style="font-size: 1.5rem; font-weight: 700;">₹${billData.interestAmount.toLocaleString("en-IN")}</div>
              </div>
              <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                Rate: ${billData.interestRate}% p.a. (${billData.interestMethod})<br/>
                Grace: ${billData.gracePeriodDays} days | Overdue: ${billData.previousBalanceDays} days<br/>
Chargeable: ${Math.ceil(Math.max(0, billData.previousBalanceDays - billData.gracePeriodDays) / 30)} month(s) (${Math.max(0, billData.previousBalanceDays - billData.gracePeriodDays)} days)              </div>
            </div>
          `
              : ""
          }
        </div>
      `
    : ""
}

      <!-- Current Charges Table -->
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151; font-weight: 600;">Current Month Charges</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: ${design.tableHeaderBg}; color: ${design.tableHeaderColor};">
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Sr.</th>
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Particulars</th>
            <th style="padding: 12px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Calculation</th>
            <th style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${billData.charges
            .map(
              (charge, idx) => `
            <tr style="background: ${idx % 2 === 0 ? design.tableRowBg1 : design.tableRowBg2};">
              <td style="padding: 10px; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">${idx + 1}</td>
              <td style="padding: 10px; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">
                <strong>${charge.name}</strong>
              </td>
              <td style="padding: 10px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 12px; color: #6b7280;">
                ${charge.calculation || (charge.fixed ? "Fixed" : "-")}
              </td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 13px;">
                ${charge.amount.toFixed(2)}
              </td>
            </tr>
          `,
            )
            .join("")}
          <tr style="background: #f9fafb;">
            <td colspan="3" style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 14px;">Subtotal</td>
            <td style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 700; font-size: 14px;">
              ${billData.subtotal.toFixed(2)}
            </td>
          </tr>
          ${
            billData.serviceTax > 0
              ? `
            <tr style="background: #f9fafb;">
              <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Service Tax (${billData.serviceTaxRate}%)</td>
              <td style="padding: 10px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-weight: 600; font-size: 13px;">
                ${billData.serviceTax.toFixed(2)}
              </td>
            </tr>
          `
              : ""
          }
          <tr style="background: ${design.totalBg}; font-weight: 700;">
            <td colspan="3" style="padding: 14px; text-align: right; border: 1px solid ${design.tableBorderColor}; color: ${design.totalColor}; font-size: 15px;">
              CURRENT BILL TOTAL
            </td>
            <td style="padding: 14px; text-align: right; border: 1px solid ${design.tableBorderColor}; color: ${design.totalColor}; font-size: 16px;">
              ₹${billData.currentBillTotal.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Grand Total -->
      <div style="background: ${design.totalBg}; padding: 25px; border-radius: 8px; margin-bottom: 30px; border: 3px solid ${design.totalColor};">
        <div style="margin-bottom: 15px;">
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">Calculation:</div>
          <div style="font-size: 13px; color: #374151; line-height: 1.6;">
${
  Math.abs(billData.previousBalance) > 0
    ? `
              <div>Previous Balance: <strong>₹${billData.previousBalance.toFixed(2)}</strong></div>
            `
    : ""
}
            ${
              billData.interestAmount > 0
                ? `
              <div>Interest: <strong>+₹${billData.interestAmount.toFixed(2)}</strong></div>
            `
                : ""
            }
            <div>Current Bill: <strong>+₹${billData.currentBillTotal.toFixed(2)}</strong></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 15px; border-top: 2px solid ${billData.grandTotal <= 0 ? "#059669" : design.totalColor};">
  <div style="font-size: 16px; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : design.totalColor};">
    ${billData.grandTotal <= 0 ? "ADVANCE CREDIT BALANCE" : "TOTAL AMOUNT PAYABLE"}
  </div>
  <div style="font-size: ${design.totalSize}px; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : design.totalColor};">
    ₹${Math.abs(billData.grandTotal).toFixed(2)}
  </div>
</div>
${
  billData.grandTotal <= 0
    ? `
  <div style="margin-top: 10px; padding: 8px 12px; background: #d1fae5; border-radius: 6px; font-size: 11px; color: #065f46;">
    No payment due. ₹${Math.abs(billData.grandTotal).toFixed(2)} credit will be adjusted in next bill.
  </div>
`
    : ""
}
      </div>

      <!-- Footer Instructions -->
      ${
        design.footerText && design.footerText.length > 0
          ? `
        <div style="border-top: 2px solid #e5e7eb; padding-top: 20px; margin-bottom: 30px;">
          <strong style="display: block; margin-bottom: 10px; color: #1f2937;">Terms & Conditions:</strong>
          <ol style="margin: 0; padding-left: 20px; font-size: ${design.footerSize}px; color: #6b7280; line-height: 1.8;">
            ${design.footerText.map((text) => `<li style="margin-bottom: 5px;">${text}</li>`).join("")}
          </ol>
        </div>
      `
          : ""
      }

      <!-- Signature -->
      ${
        design.showSignature
          ? `
        <div style="text-align: right; margin-top: 40px;">
          ${
            signatureUrl
              ? `
            <img src="${signatureUrl}" style="width: 150px; height: auto; margin-bottom: 10px;" />
          `
              : `
            <div style="height: 60px; border-bottom: 2px solid #000; width: 200px; margin-left: auto; margin-bottom: 10px;"></div>
          `
          }
          <div style="font-size: 12px; color: #6b7280; font-weight: 600;">${design.signatureLabel || "Authorized Signatory"}</div>
        </div>
      `
          : ""
      }

      <!-- Generation Info -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #9ca3af;">
        Generated on ${new Date().toLocaleString("en-IN")} | Computer Generated Bill
      </div>
    </div>
  `;
  };

  const currentBill = previewData?.[previewIndex];
  const isCurrentSelected = currentBill
    ? selectedMemberIds.has(currentBill.memberId)
    : false;

  const downloadBillTemplate = async () => {
    if (!canDownload) return;
    try {
      const memberIdsParam = selectedMemberIdsArray.join(",");
      const res = await fetch(
        `/api/billing/excel-template?month=${billMonth + 1}&year=${billYear}&memberIds=${encodeURIComponent(memberIdsParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || "Download failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BillTemplate_${periodLabel}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Download failed: " + e.message); }
  };

  const downloadPaymentTemplate = async () => {
    if (!canDownload) return;
    try {
      const memberIdsParam = selectedMemberIdsArray.join(",");
      const res = await fetch(
        `/api/billing/payment-template?month=${billMonth + 1}&year=${billYear}&memberIds=${encodeURIComponent(memberIdsParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || "Download failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PaymentTemplate_${periodLabel}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Download failed: " + e.message); }
  };

  const handlePayPreview = async () => {
    if (!payFile) return;
    setPayPreviewing(true);
    setPayPreview(null);
    setPayBatchKey(null);
    setPayResults(null);
    try {
      const fd = new FormData();
      fd.append("file", payFile);
      const res = await fetch(`/api/billing/upload-payments?action=preview`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Preview failed");
      setPayPreview(data);
      setPayBatchKey(data.batchKey);
      if (data.gridRows && data.gridColumns) {
        setPayGrid({ gridRows: data.gridRows, columns: data.gridColumns });
      }
    } catch (e) {
      alert("Preview failed: " + e.message);
    } finally {
      setPayPreviewing(false);
    }
  };

  const handlePayConfirm = async () => {
    if (!payBatchKey) return;
    if (!confirm(`Process ${payPreview.validRows} payment(s) totalling ₹${payPreview.totalAmount?.toFixed(2)}? This cannot be undone.`)) return;
    setPayConfirming(true);
    try {
      const res = await fetch(`/api/billing/upload-payments?action=confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchKey: payBatchKey }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Confirm failed");
      setPayResults(data);
      setPayPreview(null);
      setPayBatchKey(null);
      setPayFile(null);
    } catch (e) {
      alert("Payment processing failed: " + e.message);
    } finally {
      setPayConfirming(false);
    }
  };

  const checkPrevMonthPayments = async () => {
    const prevMonth = billMonth === 0 ? 11 : billMonth - 1;
    const prevYear = billMonth === 0 ? billYear - 1 : billYear;
    const prevPeriodId = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}`;
    try {
      const res = await fetch(`/api/billing/check-payments-uploaded?periodId=${prevPeriodId}`, { credentials: "include" });
      const data = await res.json();
      return data.uploaded;
    } catch {
      return true; // on error, don't block
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>⚡ Generate Bills</h1>
          <p>Select members → generate bills → collect payments</p>
        </div>
      </div>

      {/* Stats Banner */}
      {membersData?.members && (
        <div className={styles.statsBanner}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{membersData.members.length}</div>
            <div className={styles.statLabel}>Total Members</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{billingHeadsData?.heads?.length || 0}</div>
            <div className={styles.statLabel}>Billing Heads</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>{societyData?.society?.config?.interestRate || 0}%</div>
            <div className={styles.statLabel}>Interest Rate</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber} style={{ color: selectedMemberIds.size > 0 ? "#059669" : "#6b7280" }}>
              {selectedMemberIds.size}
            </div>
            <div className={styles.statLabel}>Selected</div>
          </div>
        </div>
      )}

      {/* Automatic Mode Warning Dialog */}
      {showAutoWarning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "12px", padding: "2rem", maxWidth: "480px", width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 1rem", color: "#b45309" }}>⚠ Previous Month Payment Collection Not Uploaded</h3>
            <p style={{ fontSize: "0.875rem", color: "#374151", lineHeight: 1.6 }}>
              No payment collection was uploaded for the previous billing period. If you continue, all previous balances will remain unpaid and interest may be applied automatically.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={() => setShowAutoWarning(false)}>Upload Sheet First</button>
              <button className="btn btn-danger" onClick={() => setShowAutoWarning(false)}>Force Generate Anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* Automatic Mode Banner */}
      {billGenerationMode === "AUTOMATIC" && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "0.75rem 1.25rem", marginBottom: "1rem", fontSize: "0.875rem", color: "#92400e", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>⚡</span>
          <strong>Automatic Mode Active</strong> — Bills will be auto-generated on day {societyData?.society?.config?.billAutoGenerateDay ?? 1} of each month. Previous month payment upload is required before auto-generation.
        </div>
      )}

      {/* Billing Period */}
      <div className={styles.formCard}>
        <h2>📅 Billing Period</h2>
        <div className={styles.formGrid}>
          <div className={styles.formGroup}>
            <label>Bill Month</label>
            <select value={billMonth} onChange={(e) => setBillMonth(parseInt(e.target.value))} className={styles.select}>
              {Array.from({ length: 12 }, (_, i) => {
                const isPast = billYear < CUR_YEAR || (billYear === CUR_YEAR && i < CUR_MONTH);
                return (
                  <option key={i} value={i} disabled={isPast}>
                    {new Date(2000, i).toLocaleString("default", { month: "long" })}
                    {isPast ? " (past)" : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label>Bill Year</label>
            <input
              type="number"
              value={billYear}
              onChange={(e) => { const y = parseInt(e.target.value); setBillYear(y); if (y === CUR_YEAR && billMonth < CUR_MONTH) setBillMonth(CUR_MONTH); }}
              min={CUR_YEAR}
              max={2035}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Due Date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={styles.input} />
          </div>
        </div>
      </div>

      {/* Billing Run Configuration */}
      <div style={{ background: "#fff", border: "2px solid #e0e7ff", borderRadius: "12px", padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", color: "#3730a3" }}>
          ⚙️ Billing Run Configuration
          <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "#6b7280", marginLeft: "0.5rem" }}>(per-run overrides — not saved to society settings)</span>
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
          {[
            { label: "Bill Due Day", value: billDueDay, setter: setBillDueDay, min: 1, max: 31, hint: "Day of month bill is due" },
            { label: "Grace Period (days)", value: gracePeriodDays, setter: setGracePeriodDays, min: 0, max: 90, hint: "Days before interest kicks in" },
            { label: "Payment Final Day", value: billPayFinalDay, setter: setBillPayFinalDay, min: 0, max: 31, hint: "0 = no cutoff" },
            { label: "Visible From Day", value: billVisibleFromDay, setter: setBillVisibleFromDay, min: 1, max: 31, hint: "Day members can see bill" },
          ].map(({ label, value, setter, min, max, hint }) => (
            <div key={label}>
              <label style={{ display: "block", fontSize: "0.78rem", color: "#374151", marginBottom: "4px", fontWeight: 600 }}>{label}</label>
              <input type="number" value={value} min={min} max={max} onChange={(e) => setter(parseInt(e.target.value) || 0)} style={{ width: "100%", padding: "0.4rem 0.6rem", border: "1px solid #c7d2fe", borderRadius: "6px", fontSize: "0.875rem" }} />
              <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "2px" }}>{hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Member Selector */}
      <div style={{ background: "#fff", border: "2px solid #e5e7eb", borderRadius: "12px", marginBottom: "1.5rem", overflow: "hidden" }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.5rem", background: "#f9fafb", borderBottom: selectorOpen ? "1px solid #e5e7eb" : "none", cursor: "pointer" }}
          onClick={() => setSelectorOpen((o) => !o)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "1.25rem" }}>👥</span>
            <div>
              <div style={{ fontWeight: 700, color: "#1f2937", fontSize: "1rem" }}>
                Member Selection
                {selectedMemberIds.size > 0 && (
                  <span style={{ marginLeft: "0.75rem", background: "#059669", color: "white", padding: "2px 10px", borderRadius: "12px", fontSize: "0.78rem", fontWeight: 700 }}>
                    {selectedMemberIds.size} selected
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>Select members before downloading templates or generating bills</div>
            </div>
          </div>
          <span style={{ color: "#6b7280", fontSize: "1.2rem" }}>{selectorOpen ? "▲" : "▼"}</span>
        </div>

        {selectorOpen && (
          <div style={{ padding: "1rem 1.5rem" }}>
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <input type="text" placeholder="Search name / flat..." value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} style={{ flex: 1, minWidth: 160, padding: "0.4rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem" }} />
              <select value={wingFilter} onChange={(e) => setWingFilter(e.target.value)} style={{ padding: "0.4rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "0.875rem" }}>
                {wings.map((w) => <option key={w} value={w}>{w === "all" ? "All Wings" : `Wing ${w}`}</option>)}
              </select>
              <button className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 0.9rem" }} onClick={selectAll}>Select All ({filteredMembers.length})</button>
              <button className="btn btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 0.9rem" }} onClick={deselectAll}>Deselect All</button>
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
              {filteredMembers.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#9ca3af" }}>No members found</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: "8px 10px", textAlign: "center", borderBottom: "1px solid #e5e7eb", width: 40 }}>
                        <input type="checkbox" checked={filteredMembers.length > 0 && filteredMembers.every((m) => selectedMemberIds.has(m._id))} onChange={(e) => (e.target.checked ? selectAll() : deselectAll())} />
                      </th>
                      <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Wing</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Flat</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((m, i) => {
                      const selected = selectedMemberIds.has(m._id);
                      return (
                        <tr key={m._id} style={{ background: selected ? "#f0fdf4" : i % 2 === 0 ? "#fff" : "#f9fafb", cursor: "pointer" }} onClick={() => toggleMember(m._id)}>
                          <td style={{ padding: "7px 10px", textAlign: "center", borderBottom: "1px solid #f3f4f6" }}>
                            <input type="checkbox" checked={selected} onChange={() => toggleMember(m._id)} onClick={(e) => e.stopPropagation()} />
                          </td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #f3f4f6", fontWeight: 600 }}>{m.wing}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #f3f4f6" }}>{m.flatNo}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #f3f4f6" }}>{m.ownerName}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {!canDownload && (
              <div style={{ marginTop: "0.75rem", padding: "0.6rem 1rem", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: "6px", fontSize: "0.8rem", color: "#92400e", fontWeight: 600 }}>
                ⚠ Select at least one member to enable template downloads and bill generation.
              </div>
            )}
          </div>
        )}
      </div>

      {/* FLOW 1 header */}
      <div style={{ background: "#fff", border: "2px solid #bfdbfe", borderRadius: "12px", marginBottom: "1.5rem", overflow: "hidden" }}>
        <div style={{ background: "#eff6ff", padding: "1rem 1.5rem", borderBottom: "1px solid #bfdbfe" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#1e40af" }}>📋 Flow 1 — Bill Generation</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#3b82f6" }}>Download pre-filled template → review/edit → upload → system validates and generates bills</p>
        </div>
        <div style={{ padding: "1.5rem" }}>

          {/* 1A: Download Bill Generation Template */}
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: "10px", padding: "1.25rem", marginBottom: "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#0369a1" }}>1A — Download Bill Generation Template</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#6b7280", lineHeight: 1.5 }}>
              Pre-filled with: member info, opening principal/interest, calculated charges, calculated interest, bill principal, bill interest, total bill due. Admin reviews and uploads back.
            </p>
            <div style={{ fontSize: "0.78rem", color: "#0c4a6e", background: "#e0f2fe", borderRadius: "6px", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
              <strong>Columns:</strong> MemberId · Wing · FlatNo · OwnerName · Month · Year · DueDate ·{" "}
              {billingHeadsData?.heads?.filter((h) => h.isActive && !h.isDeleted).map((h) => h.headName).join(" · ")}{" "}· Total · PreviousBalance · InterestDue · GrandTotal
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" disabled={!canDownload} onClick={downloadBillTemplate} style={{ opacity: canDownload ? 1 : 0.5 }}>
                📥 Download Bill Generation Template ({periodLabel}){selectedMemberIds.size > 0 ? ` — ${selectedMemberIds.size} members` : ""}
              </button>
              <button className="btn btn-secondary" disabled={!canDownload || isPreviewing} onClick={generatePreview} style={{ opacity: canDownload ? 1 : 0.5, fontSize: "0.875rem" }}>
                {isPreviewing ? (
                  <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span className="loading-spinner" />
                    {previewProgress.label === "fetching" ? "Fetching balances..." : `Calculating ${previewProgress.current}/${previewProgress.total}`}
                  </span>
                ) : "👁️ Preview Bills"}
              </button>
            </div>
          </div>

          {/* 1B: Upload Bill Generation Template */}
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "1.25rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#374151" }}>1B — Upload Bill Generation Template</h3>
            <p style={{ margin: "0 0 1rem", fontSize: "0.8rem", color: "#6b7280", lineHeight: 1.5 }}>
              Upload the downloaded (and optionally edited) Excel. System validates all rows, checks duplicates, compares amounts.
            </p>

            {/* File upload for 1B */}
            <div
              style={{
                border: "2px dashed #d1d5db",
                borderRadius: "10px",
                padding: "2rem",
                textAlign: "center",
                background: excelFile ? "#f0fdf4" : "#fafafa",
                marginBottom: "1rem",
              }}
            >
              {excelFile ? (
                <div>
                  <div style={{ fontSize: "2rem" }}>✅</div>
                  <div style={{ fontWeight: 600, color: "#059669", margin: "0.5rem 0" }}>{excelFile.name}</div>
                  <div style={{ fontSize: "0.875rem", color: "#6b7280" }}>{(excelFile.size / 1024).toFixed(1)} KB</div>
                  <button style={{ marginTop: "0.75rem", background: "none", border: "1px solid #d1d5db", borderRadius: "6px", padding: "0.25rem 0.75rem", cursor: "pointer", color: "#6b7280", fontSize: "0.875rem" }} onClick={() => { setExcelFile(null); setExcelValidation(null); }}>Remove</button>
                </div>
              ) : (
                <label htmlFor="excelUpload" style={{ cursor: "pointer" }}>
                  <div style={{ fontSize: "2rem" }}>📂</div>
                  <div style={{ fontWeight: 600, color: "#374151", margin: "0.5rem 0" }}>Click to select Bill Generation Template</div>
                  <div style={{ fontSize: "0.875rem", color: "#9ca3af" }}>.xlsx or .xls — max 5MB</div>
                  <input id="excelUpload" type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { setExcelFile(e.target.files[0] || null); setExcelValidation(null); }} />
                </label>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
              <button
                className="btn btn-primary"
                disabled={!excelFile || excelValidating}
                onClick={async () => {
                  setExcelValidating(true);
                  setExcelValidation(null);
                  try {
                    const formData = new FormData();
                    formData.append("file", excelFile);
                    formData.append("month", String(billMonth + 1));
                    formData.append("year", String(billYear));
                    formData.append("dueDate", dueDate);
                    const res = await fetch("/api/billing/validate-excel", { method: "POST", body: formData, credentials: "include" });
                    const data = await res.json();
                    setExcelValidation(data);
                    setApprovedDiffs(new Set());
                    if (data.gridRows && data.gridColumns) {
                      setBillGrid({ gridRows: data.gridRows, columns: data.gridColumns });
                    }
                  } catch (e) {
                    alert("Validation error: " + e.message);
                  } finally {
                    setExcelValidating(false);
                  }
                }}
              >
                {excelValidating ? "⏳ Validating..." : "✓ Validate"}
              </button>
            </div>

            {billGrid && (
              <ExcelPreviewGrid
                title={`Bill Template Preview — ${periodLabel}`}
                columns={billGrid.columns}
                rows={billGrid.gridRows}
                onReupload={() => { setExcelFile(null); setExcelValidation(null); setBillGrid(null); setApprovedDiffs(new Set()); }}
                onContinue={(validRows) => { console.log("Proceeding with", validRows.length, "valid rows"); }}
                onCancel={() => { setExcelFile(null); setExcelValidation(null); setBillGrid(null); setApprovedDiffs(new Set()); }}
              />
            )}

            {excelValidation && !excelValidation.canProceed && (
              <div style={{ background: "#fef2f2", border: "2px solid #fca5a5", borderRadius: "10px", padding: "1.25rem", marginBottom: "1rem" }}>
                <h4 style={{ color: "#dc2626", margin: "0 0 0.75rem" }}>❌ Validation Failed</h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem", marginBottom: "1rem" }}>
                  {[["Errors", "#dc2626", excelValidation.errorCount], ["Warnings", "#d97706", excelValidation.warningCount], ["Duplicates", "#7c3aed", excelValidation.duplicateCount]].map(([l, c, v]) => (
                    <div key={l} style={{ textAlign: "center", padding: "0.75rem", borderRadius: "8px", background: "white", border: `2px solid ${c}` }}>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: c }}>{v}</div>
                      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>{l}</div>
                    </div>
                  ))}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead><tr style={{ background: "#fca5a5" }}>{["Row","Type","What went wrong","How to fix"].map((h) => (<th key={h} style={{ padding: "6px 10px", textAlign: "left", border: "1px solid #fca5a5" }}>{h}</th>))}</tr></thead>
                  <tbody>
                    {excelValidation.issues?.map((issue, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fef9f9" }}>
                        <td style={{ padding: "6px 10px", border: "1px solid #fca5a5", fontWeight: 600 }}>{issue.row ?? "–"}</td>
                        <td style={{ padding: "6px 10px", border: "1px solid #fca5a5" }}>
                          <span style={{ background: issue.type === "error" ? "#dc2626" : issue.type === "duplicate" ? "#7c3aed" : "#d97706", color: "white", padding: "2px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600 }}>{issue.type?.toUpperCase()}</span>
                        </td>
                        <td style={{ padding: "6px 10px", border: "1px solid #fca5a5", color: "#991b1b" }}>{issue.message}</td>
                        <td style={{ padding: "6px 10px", border: "1px solid #fca5a5", color: "#065f46" }}>{issue.fix}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {excelValidation?.canProceed && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
                  {[["✅ Valid", excelValidation.validCount, "#059669", "#d1fae5", "#a7f3d0"],["⚠ Warnings", excelValidation.warningCount, "#d97706", "#fef3c7", "#fde68a"],["🔴 Errors", excelValidation.errorCount, "#dc2626", "#fee2e2", "#fca5a5"],["🔶 Diffs", excelValidation.diffCount, "#b45309", "#fff7ed", "#fed7aa"]].map(([label, count, color, bg, border]) => (
                    <div key={label} style={{ textAlign: "center", padding: "1rem", borderRadius: "10px", background: bg, border: `2px solid ${border}` }}>
                      <div style={{ fontSize: "1.6rem", fontWeight: 700, color }}>{count}</div>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, color, marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {diffIssues.length > 0 && (
                  <div style={{ background: "#fff7ed", border: "2px solid #f97316", borderRadius: "12px", padding: "1.25rem", marginBottom: "1.5rem" }}>
                    <h4 style={{ margin: "0 0 1rem", color: "#9a3412", fontSize: "1rem", fontWeight: 700 }}>
                      🔶 {diffIssues.length} Amount Mismatch{diffIssues.length > 1 ? "es" : ""} — Must Approve Each
                    </h4>
                    {diffIssues.map((issue, i) => (
                      <div key={i} style={{ background: approvedDiffs.has(issue.memberId) ? "#f0fdf4" : "#fff", border: `2px solid ${approvedDiffs.has(issue.memberId) ? "#86efac" : "#f97316"}`, borderRadius: "8px", padding: "1rem", marginBottom: "0.75rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, color: "#7c2d12", fontSize: "0.95rem", marginBottom: "0.5rem" }}>🏠 {issue.flat} — {issue.name}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem" }}>
                              {[["Excel Total",`₹${issue.excelTotal}`,"#dc2626"],["System Calc",`₹${issue.autoTotal}`,"#059669"],["Difference",`₹${issue.diff > 0 ? "+" : ""}${issue.diff}`,issue.diff < 0 ? "#dc2626" : "#d97706"]].map(([l,v,c]) => (
                                <div key={l} style={{ background: "#f9fafb", borderRadius: "6px", padding: "0.5rem", textAlign: "center", border: "1px solid #e5e7eb" }}>
                                  <div style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: "2px" }}>{l}</div>
                                  <div style={{ fontSize: "1rem", fontWeight: 700, color: c }}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "#92400e" }}>{issue.fix}</div>
                          </div>
                          <label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", cursor: "pointer", minWidth: "80px", textAlign: "center", background: approvedDiffs.has(issue.memberId) ? "#d1fae5" : "#fee2e2", border: `2px solid ${approvedDiffs.has(issue.memberId) ? "#059669" : "#dc2626"}`, borderRadius: "8px", padding: "0.75rem" }}>
                            <input type="checkbox" checked={approvedDiffs.has(issue.memberId)} onChange={(e) => { setApprovedDiffs((prev) => { const next = new Set(prev); e.target.checked ? next.add(issue.memberId) : next.delete(issue.memberId); return next; }); }} style={{ width: 18, height: 18, cursor: "pointer" }} />
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: approvedDiffs.has(issue.memberId) ? "#059669" : "#dc2626" }}>{approvedDiffs.has(issue.memberId) ? "APPROVED" : "APPROVE?"}</span>
                          </label>
                        </div>
                      </div>
                    ))}
                    {!allDiffsApproved && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "0.75rem", marginTop: "0.5rem", fontSize: "0.8rem", color: "#991b1b", fontWeight: 600, textAlign: "center" }}>
                        ❌ Generate blocked — approve all {diffIssues.length - approvedDiffs.size} remaining mismatch{diffIssues.length - approvedDiffs.size > 1 ? "es" : ""} to unlock
                      </div>
                    )}
                  </div>
                )}

                {excelValidation.comparison?.filter((r) => !r.hasDiff).length > 0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <h4 style={{ margin: "0 0 0.75rem", color: "#374151", fontSize: "0.95rem", fontWeight: 700 }}>✅ Matched Rows ({excelValidation.comparison.filter((r) => !r.hasDiff).length})</h4>
                    <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                        <thead style={{ position: "sticky", top: 0, background: "#d1fae5", zIndex: 1 }}>
                          <tr>{["Flat","Member","Excel Total","Auto Total","Status"].map((h) => (<th key={h} style={{ padding: "8px 10px", border: "1px solid #a7f3d0", textAlign: h.includes("Total") ? "right" : "left", color: "#065f46", fontWeight: 700 }}>{h}</th>))}</tr>
                        </thead>
                        <tbody>
                          {excelValidation.comparison.filter((r) => !r.hasDiff).map((row, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                              <td style={{ padding: "7px 10px", border: "1px solid #e5e7eb", fontWeight: 600 }}>{row.flat}</td>
                              <td style={{ padding: "7px 10px", border: "1px solid #e5e7eb" }}>{row.name}</td>
                              <td style={{ padding: "7px 10px", border: "1px solid #e5e7eb", textAlign: "right", fontWeight: 600 }}>₹{row.excelTotal.toFixed(2)}</td>
                              <td style={{ padding: "7px 10px", border: "1px solid #e5e7eb", textAlign: "right", color: "#6b7280" }}>₹{row.autoTotal.toFixed(2)}</td>
                              <td style={{ padding: "7px 10px", border: "1px solid #e5e7eb", textAlign: "center" }}>
                                <span style={{ background: "#d1fae5", color: "#065f46", padding: "2px 10px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 700 }}>✓ Match</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", borderTop: "2px solid #e5e7eb", paddingTop: "1.25rem" }}>
                  <button className="btn btn-secondary" onClick={() => { setExcelFile(null); setExcelValidation(null); }}>← Re-upload</button>
                  <button
                    className={`btn ${canGenerate ? "btn-success" : "btn-secondary"}`}
                    style={{ minWidth: 240, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? "pointer" : "not-allowed" }}
                    disabled={!canGenerate}
                    onClick={async () => {
                      if (!confirm(`Generate ${excelValidation.validCount} bills from Excel for ${periodLabel}?\n\n${diffIssues.length > 0 ? `⚠ You approved ${diffIssues.length} manual amount override(s).` : "All amounts match auto-calculation."}`)) return;
                      setExcelImporting(true);
                      try {
                        const res = await fetch("/api/billing/generate-from-excel", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bills: excelValidation.bills, billMonth, billYear, dueDate }) });
                        const data = await res.json();
                        if (!data.success) throw new Error(data.error || "Generation failed");
                        alert(`✅ Generated ${data.count} bills successfully from Excel.`);
                        queryClient.invalidateQueries(["bills-list"]);
                        setExcelFile(null);
                        setExcelValidation(null);
                      } catch (e) {
                        alert("❌ Failed: " + e.message);
                      } finally {
                        setExcelImporting(false);
                      }
                    }}
                  >
                    {excelImporting ? "⏳ Generating..." : !canGenerate ? `🔒 Approve ${diffIssues.length - approvedDiffs.size} Diff${diffIssues.length - approvedDiffs.size > 1 ? "s" : ""} to Unlock` : `🚀 Generate ${excelValidation.validCount} Bills from Excel`}
                  </button>
                  {canGenerate && diffIssues.length > 0 && (
                    <span style={{ fontSize: "0.8rem", color: "#d97706", fontWeight: 600 }}>⚠ {diffIssues.length} manual override{diffIssues.length > 1 ? "s" : ""} approved</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FLOW 2 — PAYMENT COLLECTION */}
      <div style={{ background: "#fff", border: "2px solid #bbf7d0", borderRadius: "12px", marginBottom: "1.5rem", overflow: "hidden" }}>
        <div style={{ background: "#f0fdf4", padding: "1rem 1.5rem", borderBottom: "1px solid #bbf7d0" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#166534" }}>💳 Flow 2 — Payment Collection</h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#16a34a" }}>Download payment template → admin fills AmountPaid/Method/Date → upload → system validates and records payments</p>
        </div>
        <div style={{ padding: "1.5rem" }}>

          {/* 2A: Download Payment Collection Template */}
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", padding: "1.25rem", marginBottom: "1.5rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#166534" }}>2A — Download Payment Collection Template</h3>
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "#6b7280", lineHeight: 1.5 }}>
              Pre-filled with: opening balances, bill totals, remaining due, already paid, bill status. Admin fills ONLY: AmountPaid, PaymentMethod, PaymentDate, Remarks.
            </p>
            <div style={{ fontSize: "0.78rem", color: "#166534", background: "#dcfce7", borderRadius: "6px", padding: "0.5rem 0.75rem", marginBottom: "1rem" }}>
              <strong>Read-only:</strong> MemberId · Wing · FlatNo · OwnerName · Month · Year · OpeningPrincipal · OpeningInterest · CurrentCharges · CurrentInterest · BillPrincipal · BillInterest · TotalBillDue · AlreadyPaid · RemainingDue · BillStatus<br />
              <strong>Fill these:</strong> AmountPaid · PaymentMethod · PaymentDate · Remarks
            </div>
            <button className="btn btn-success" disabled={!canDownload} onClick={downloadPaymentTemplate} style={{ opacity: canDownload ? 1 : 0.5 }}>
              📥 Download Payment Collection Template ({periodLabel}){selectedMemberIds.size > 0 ? ` — ${selectedMemberIds.size} members` : ""}
            </button>
          </div>

          {/* 2B: Upload Payment Collection Template */}
          <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "1.25rem" }}>
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#374151" }}>2B — Upload Filled Payment Template</h3>
            <p style={{ margin: "0 0 1rem", fontSize: "0.8rem", color: "#6b7280", lineHeight: 1.5 }}>
              Upload the filled payment template. System validates, previews allocations, then you confirm to post payments and generate receipts.
            </p>

            {!payPreview && !payResults && (
              <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", color: "#374151", marginBottom: 4 }}>Filled Payment Template (.xlsx)</label>
                  <input type="file" accept=".xlsx,.xls" onChange={(e) => setPayFile(e.target.files?.[0] || null)} style={{ fontSize: "0.875rem" }} />
                </div>
                <button className="btn btn-primary" disabled={!payFile || payPreviewing} onClick={handlePayPreview}>
                  {payPreviewing ? "⏳ Validating..." : "🔍 Validate & Preview"}
                </button>
              </div>
            )}

            {payGrid && (
              <ExcelPreviewGrid
                title={`Payment Template Preview — ${periodLabel}`}
                columns={payGrid.columns}
                rows={payGrid.gridRows}
                onReupload={() => { setPayFile(null); setPayPreview(null); setPayBatchKey(null); setPayGrid(null); setPayResults(null); }}
                onContinue={(_validRows) => { /* actual confirm uses handlePayConfirm button below */ }}
                onCancel={() => { setPayFile(null); setPayPreview(null); setPayBatchKey(null); setPayGrid(null); setPayResults(null); }}
              />
            )}

            {payPreview && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
                  {[{ label: "Total Rows", value: payPreview.totalRows },{ label: "Valid", value: payPreview.validRows, color: "#059669" },{ label: "Errors", value: payPreview.failedRows, color: payPreview.failedRows > 0 ? "#dc2626" : undefined },{ label: "Total Amount", value: `₹${(payPreview.totalAmount || 0).toFixed(2)}` }].map(({ label, value, color }) => (
                    <div key={label} style={{ background: "#f9fafb", borderRadius: 8, padding: "0.75rem", textAlign: "center" }}>
                      <div style={{ fontSize: "1.4rem", fontWeight: 700, color: color || "#1f2937" }}>{value}</div>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {payPreview.errors?.length > 0 && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "0.75rem", marginBottom: "1rem" }}>
                    <strong style={{ color: "#dc2626" }}>Row Errors:</strong>
                    <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", fontSize: "0.8rem", color: "#7f1d1d" }}>
                      {payPreview.errors.map((e, i) => <li key={i}>Row {e.rowNum}: {e.errors.join(", ")}</li>)}
                    </ul>
                  </div>
                )}

                <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead><tr style={{ background: "#f3f4f6" }}>{["Row","Flat","Member","Period","Bill Due","Paying","Method","Date","Status"].map((h) => (<th key={h} style={{ padding: "0.5rem 0.75rem", textAlign: "left", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {payPreview.preview.map((row, i) => (
                        <tr key={i} style={{ background: row.status === "Failed" ? "#fef2f2" : i % 2 === 0 ? "#fff" : "#f9fafb" }}>
                          <td style={{ padding: "0.4rem 0.75rem" }}>{row.rowNum}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>{row.flat}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>{row.memberName}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>{row.billPeriodId}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>₹{(row.remaining || 0).toFixed(2)}</td>
                          <td style={{ padding: "0.4rem 0.75rem", fontWeight: 600 }}>₹{(row.amountPaid || 0).toFixed(2)}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>{row.paymentMethod}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}>{row.paymentDate}</td>
                          <td style={{ padding: "0.4rem 0.75rem" }}><span style={{ color: row.status === "Valid" ? "#059669" : "#dc2626", fontWeight: 600 }}>{row.status === "Failed" ? `❌ ${row.errors?.join(", ")}` : "✅ Valid"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <button className="btn btn-success" disabled={payPreview.validRows === 0 || payConfirming} onClick={handlePayConfirm}>
                    {payConfirming ? "⏳ Processing..." : `✅ Confirm & Process ${payPreview.validRows} Payment(s)`}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setPayPreview(null); setPayBatchKey(null); setPayFile(null); }}>← Re-upload</button>
                </div>
              </div>
            )}

            {payResults && (
              <div>
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
                  <strong style={{ color: "#166534" }}>✅ Payments Processed</strong>
                  <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#166534" }}>
                    {payResults.successRows} succeeded · {payResults.failedRows} failed · Total ₹{(payResults.totalAmountProcessed || 0).toFixed(2)} · Interest cleared ₹{(payResults.totalInterestCleared || 0).toFixed(2)} · Principal cleared ₹{(payResults.totalPrincipalCleared || 0).toFixed(2)}
                  </div>
                </div>
                {payResults.failedRows > 0 && (
                  <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                      <thead><tr style={{ background: "#fef2f2" }}>{["Flat","Member","Amount","Error"].map((h) => (<th key={h} style={{ padding: "0.4rem 0.75rem", textAlign: "left", borderBottom: "1px solid #fca5a5" }}>{h}</th>))}</tr></thead>
                      <tbody>{payResults.results?.filter((r) => r.status === "Failed").map((r, i) => (<tr key={i}><td style={{ padding: "0.4rem 0.75rem" }}>{r.flat}</td><td style={{ padding: "0.4rem 0.75rem" }}>{r.memberName}</td><td style={{ padding: "0.4rem 0.75rem" }}>₹{(r.amountPaid || 0).toFixed(2)}</td><td style={{ padding: "0.4rem 0.75rem", color: "#dc2626" }}>{r.errorMessage}</td></tr>))}</tbody>
                    </table>
                  </div>
                )}
                <button className="btn btn-secondary" onClick={() => setPayResults(null)}>Upload Another Batch</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && previewData && currentBill && (
        <div className={styles.modal} onClick={() => setShowPreview(false)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <div
                  className={styles.modalHeader}
                  // or your existing header container
                >
                  <h2>Bill Preview - {currentBill.member}</h2>
                  {currentBill && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isCurrentSelected}
                        onChange={(e) => {
                          setSelectedMemberIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked)
                              next.add(currentBill.memberId);
                            else next.delete(currentBill.memberId);
                            return next;
                          });
                        }}
                      />
                      Include this member
                    </label>
                  )}
                </div>{" "}
                <p
                  style={{
                    margin: "5px 0 0 0",
                    color: "#6b7280",
                    fontSize: "0.95rem",
                  }}
                >
                  {currentBill.memberName} | {currentBill.area} sq ft
                  {currentBill.previousBalance > 0 && (
                    <span
                      style={{
                        color: "#dc2626",
                        fontWeight: "600",
                        marginLeft: "15px",
                      }}
                    >
                      ⚠️ Has Outstanding: ₹
                      {currentBill.previousBalance.toLocaleString("en-IN")}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <div
                dangerouslySetInnerHTML={{
                  __html: renderBillHTML(currentBill),
                }}
              />
            </div>

            <div className={styles.modalFooter}>
              <div className={styles.navigation}>
                <button
                  onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                  disabled={previewIndex === 0}
                  className="btn btn-secondary"
                >
                  ← Previous
                </button>
                <span className={styles.pageInfo}>
                  <strong>{previewIndex + 1}</strong> of{" "}
                  <strong>{previewData.length}</strong>
                </span>
                <button
                  onClick={() =>
                    setPreviewIndex(
                      Math.min(previewData.length - 1, previewIndex + 1),
                    )
                  }
                  disabled={previewIndex === previewData.length - 1}
                  className="btn btn-secondary"
                >
                  Next →
                </button>
              </div>

              <button
                onClick={generateMutation.mutate}
                disabled={generateMutation.isPending}
                className="btn btn-success btn-lg"
                style={{ minWidth: 250 }}
              >
                {generateMutation.isPending ? (
                  <>
                    <span className="loading-spinner"></span>
                    {` Generating... ${genProgress.current}/${genProgress.total}`}
                    <div
                      style={{
                        marginTop: 6,
                        height: 4,
                        background: "#dbeafe",
                        borderRadius: 4,
                      }}
                    >
                      <div
                        style={{
                          width: `${genProgress.total ? (genProgress.current / genProgress.total) * 100 : 0}%`,
                          height: "100%",
                          background: "#1e40af",
                          borderRadius: 4,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </>
                ) : (
                  `  Generate Bills for ${selectedMemberIds.size} member
  ${selectedMemberIds.size === 1 ? "" : "s"}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
