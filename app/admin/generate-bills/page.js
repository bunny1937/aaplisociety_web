"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/GenerateBills.module.css";
import ExcelPreviewGrid from "../../components/ExcelPreviewGrid";
import DropZone from "components/DropZone";
// ─── Pure billing engine functions (client-safe, no DB/React imports) ────────
function buildParkingRates(heads) {
  const parkingRates = {};
  heads.forEach((h) => {
    const hLower = h.headName?.trim().toLowerCase() || "";
    if (!hLower.includes("parking")) return;
    const typeMatch = ["covered", "open", "stilt"].find((t) =>
      hLower.includes(t),
    );
    const vehicleMatch = hLower.includes("four")
      ? "Four-Wheeler"
      : hLower.includes("two")
        ? "Two-Wheeler"
        : null;
    if (typeMatch && vehicleMatch) {
      const key = `${typeMatch.charAt(0).toUpperCase() + typeMatch.slice(1)}-${vehicleMatch}`;
      parkingRates[key] = h.defaultAmount;
    }
  });
  return parkingRates;
}
function computeCurrentCharges(member, heads, parkingRates, serviceTaxRate) {
  const area = Number(
    member.carpetAreaSqft ?? member.builtUpAreaSqft ?? member.areaSqFt ?? 0,
  );
  const charges = [];
  let subtotal = 0;
  for (const head of heads) {
    if (!head.headName?.trim() || head.isActive === false) continue;
    const hLower = head.headName.trim().toLowerCase();
    if (hLower.includes("parking")) continue;
    let amount = 0;
    if (head.calculationType === "Per Sq Ft") {
      amount = area * head.defaultAmount;
    } else if (head.calculationType === "Percentage") {
      amount = (subtotal * head.defaultAmount) / 100;
    } else {
      amount = head.defaultAmount;
    }
    charges.push({
      name: head.headName,
      amount: parseFloat(amount.toFixed(2)),
    });
    subtotal += amount;
  }
  for (const slot of member.parkingSlots || []) {
    if (slot.type === "Stilt" || slot.monthlyBilling === false) continue;
    const key = `${slot.type}-${slot.vehicleType}`;
    const rate = parkingRates[key] ?? 0;
    if (rate > 0) {
      charges.push({
        name: `${slot.type} Parking - ${slot.vehicleType} (${slot.slotNumber})`,
        amount: rate,
      });
      subtotal += rate;
    }
  }
  const serviceTax =
    serviceTaxRate > 0
      ? parseFloat(((subtotal * serviceTaxRate) / 100).toFixed(2))
      : 0;
  const currentBillTotal = parseFloat((subtotal + serviceTax).toFixed(2));
  return {
    charges,
    subtotal: parseFloat(subtotal.toFixed(2)),
    serviceTax,
    currentBillTotal,
  };
}
function computeMonthlyInterest(principalOutstanding, annualRate) {
  if (principalOutstanding <= 0 || annualRate <= 0) return 0;
  return parseFloat(((principalOutstanding * annualRate) / 1200).toFixed(2));
}
function computeBillTotal({
  principalOutstanding,
  interestOutstanding,
  currInt,
  currentBillTotal,
  advanceCredit,
}) {
  const billPrincipal = parseFloat(
    (principalOutstanding + currentBillTotal).toFixed(2),
  );
  const billInterest = parseFloat((interestOutstanding + currInt).toFixed(2));
  const totalBillDue = parseFloat((billPrincipal + billInterest).toFixed(2));
  const advApplied = parseFloat(
    Math.min(advanceCredit, totalBillDue).toFixed(2),
  );
  const grandTotal = parseFloat(
    Math.max(0, totalBillDue - advApplied).toFixed(2),
  );
  return { billPrincipal, billInterest, totalBillDue, advApplied, grandTotal };
}
// ─────────────────────────────────────────────────────────────────────────────
const SLOT_TYPES = ["Open", "Covered", "Stilt"];
const VEHICLE_TYPES = ["Two-Wheeler", "Four-Wheeler"];
function TestConfigPanel({ members, periodLabel, onSaved }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [carpetArea, setCarpetArea] = useState("");
  const [slots, setSlots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [applyTo, setApplyTo] = useState("next"); // "next" | "current"
  const activeMem = (members || []).filter((m) => !m.isDeleted);
  function loadMember(id) {
    setSelectedId(id);
    setMsg("");
    const m = activeMem.find((x) => x._id === id);
    if (!m) return;
    setCarpetArea(String(m.carpetAreaSqft ?? ""));
    setSlots(
      (m.parkingSlots || []).map((s) => ({
        slotNumber: s.slotNumber || "",
        type: s.type || "Open",
        vehicleType: s.vehicleType || "Two-Wheeler",
        monthlyBilling: s.monthlyBilling !== false,
      })),
    );
  }
  function addSlot() {
    setSlots((prev) => [
      ...prev,
      {
        slotNumber: "",
        type: "Open",
        vehicleType: "Two-Wheeler",
        monthlyBilling: true,
      },
    ]);
  }
  function removeSlot(i) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }
  function patchSlot(i, key, val) {
    setSlots((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s;
        const updated = { ...s, [key]: val };
        if (key === "type") updated.monthlyBilling = val !== "Stilt";
        return updated;
      }),
    );
  }
  async function save() {
    if (!selectedId) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/members/quick-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          memberId: selectedId,
          carpetAreaSqft: carpetArea !== "" ? Number(carpetArea) : undefined,
          parkingSlots: slots,
          recalcBillPeriodId: applyTo === "current" && periodLabel ? periodLabel : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const recalcNote = data.billRecalculated ? ` · Bill ${periodLabel} updated` : "";
      setMsg(`✅ Saved: ${data.member.wing}-${data.member.flatNo}${recalcNote}`);
      onSaved?.();
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      style={{
        background: "#fffbeb",
        border: "2px dashed #f59e0b",
        borderRadius: "12px",
        marginBottom: "1.5rem",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "0.75rem 1.25rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.9rem",
          fontWeight: 600,
          color: "#92400e",
        }}
      >
        <span>{open ? "▼" : "▶"}</span>
        🧪 Test Config Panel — edit member parking &amp; carpet area instantly
      </button>
      {open && (
        <div
          style={{ padding: "1rem 1.25rem", borderTop: "1px dashed #f59e0b" }}
        >
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "flex-end",
              flexWrap: "wrap",
              marginBottom: "1rem",
            }}
          >
            <div>
              <label
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Member
              </label>
              <select
                value={selectedId}
                onChange={(e) => loadMember(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d97706",
                  minWidth: 180,
                }}
              >
                <option value="">-- select --</option>
                {activeMem.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.wing}-{m.flatNo} {m.ownerName}
                  </option>
                ))}
              </select>
            </div>
            {selectedId && (
              <div>
                <label
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Carpet Area (sqft)
                </label>
                <input
                  type="number"
                  value={carpetArea}
                  onChange={(e) => setCarpetArea(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #d97706",
                    width: 120,
                  }}
                />
              </div>
            )}
          </div>
          {selectedId && (
            <>
              <div
                style={{
                  marginBottom: "0.5rem",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  color: "#78350f",
                }}
              >
                Parking Slots
              </div>
              {slots.length === 0 && (
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "#92400e",
                    marginBottom: "0.5rem",
                  }}
                >
                  No slots
                </div>
              )}
              {slots.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    marginBottom: "0.4rem",
                    flexWrap: "wrap",
                    background: "#fef3c7",
                    padding: "0.4rem 0.6rem",
                    borderRadius: 6,
                  }}
                >
                  <input
                    placeholder="Slot#"
                    value={s.slotNumber}
                    onChange={(e) => patchSlot(i, "slotNumber", e.target.value)}
                    style={{
                      width: 70,
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid #d97706",
                    }}
                  />
                  <select
                    value={s.type}
                    onChange={(e) => patchSlot(i, "type", e.target.value)}
                    style={{
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid #d97706",
                    }}
                  >
                    {SLOT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={s.vehicleType}
                    onChange={(e) =>
                      patchSlot(i, "vehicleType", e.target.value)
                    }
                    style={{
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid #d97706",
                    }}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <label
                    style={{
                      fontSize: "0.78rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={s.monthlyBilling}
                      onChange={(e) =>
                        patchSlot(i, "monthlyBilling", e.target.checked)
                      }
                    />
                    Bill monthly
                  </label>
                  <button
                    onClick={() => removeSlot(i)}
                    style={{
                      background: "#ef4444",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 8px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                  alignItems: "center",
                }}
              >
                <button
                  onClick={addSlot}
                  style={{
                    background: "#f59e0b",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 14px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                  }}
                >
                  + Add Slot
                </button>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, fontSize: "0.8rem", color: "#92400e" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="radio" name="applyTo" value="next" checked={applyTo === "next"} onChange={() => setApplyTo("next")} />
                      Apply from next month
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="radio" name="applyTo" value="current" checked={applyTo === "current"} onChange={() => setApplyTo("current")} />
                      Apply to current month ({periodLabel || "…"})
                    </label>
                  </div>
                  <button
                    onClick={save}
                    disabled={saving}
                    style={{
                      background: "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 18px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    {saving ? "Saving…" : "💾 Save"}
                  </button>
                </div>
                {msg && (
                  <span
                    style={{
                      fontSize: "0.85rem",
                      color: msg.startsWith("✅") ? "#065f46" : "#991b1b",
                    }}
                  >
                    {msg}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
export default function GenerateBillsPage() {
  const queryClient = useQueryClient();
  const [billMonth, setBillMonth] = useState(null); // 0-indexed, null until auto-detected
  const [billYear, setBillYear] = useState(null);
  // Flow 1: Bill Generation
  const [showPreview, setShowPreview] = useState(false);
  const [excelFile, setExcelFile] = useState(null);
  const [excelValidation, setExcelValidation] = useState(null);
  const [excelValidating, setExcelValidating] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewProgress, setPreviewProgress] = useState({
    current: 0,
    total: 0,
  });
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });
  const [excelImporting, setExcelImporting] = useState(false);
  const [approvedDiffs, setApprovedDiffs] = useState(new Set());
  const [billsGeneratedForPeriod, setBillsGeneratedForPeriod] = useState(null); // periodLabel when bills were generated
  // Excel Preview Grids
  const [billGrid, setBillGrid] = useState(null);
  const [payGrid, setPayGrid] = useState(null);
  // Payment Collection
  const [payPreview, setPayPreview] = useState(null);
  const [payBatchKey, setPayBatchKey] = useState(null);
  const [payConfirming, setPayConfirming] = useState(false);
  const [payResults, setPayResults] = useState(null);
  const [autoGenState, setAutoGenState] = useState(null); // null | { status: "running"|"done"|"error", label, count, error }
  const diffIssues =
    excelValidation?.issues?.filter((i) => i.type === "diff") || [];
  const allDiffsApproved =
    diffIssues.length === 0 ||
    diffIssues.every((d) => approvedDiffs.has(d.memberId));
  const canGenerate = !excelImporting && allDiffsApproved;
  const runValidation = async (file) => {
    if (!file || billMonth === null || billYear === null) return;
    setExcelValidating(true);
    setExcelValidation(null);
    setBillGrid(null);
    setApprovedDiffs(new Set());
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("month", String(billMonth + 1));
      formData.append("year", String(billYear));
      const res = await fetch("/api/billing/validate-excel", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      setExcelValidation(data);
      if (data.gridRows && data.gridColumns) {
        setBillGrid({ gridRows: data.gridRows, columns: data.gridColumns });
      }
    } catch (e) {
      alert("Validation error: " + e.message);
    } finally {
      setExcelValidating(false);
    }
  };
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  const { data: latestPeriodData, isLoading: latestPeriodLoading } = useQuery({
    queryKey: ["latest-period"],
    queryFn: () => apiClient.get("/api/bills/latest-period"),
    staleTime: 30000,
  });
  // Auto-detect billing period on load
  useEffect(() => {
    if (!latestPeriodData || billMonth !== null) return;
    const {
      latestPeriodId,
      currentPeriodId,
      currentGenerated,
      allPaid,
      nextPeriodId,
    } = latestPeriodData;
   let targetPeriod;
if (!latestPeriodId) {
  // No bills ever — generate current month
  targetPeriod = currentPeriodId;
} else if (!allPaid) {
  // Latest period still has UNPAID bills — stay on it so the template flow
  // can COLLECT those payments. Generating the next month is a separate,
  // explicit action via the "Next Month Generation" button below.
  targetPeriod = latestPeriodId;
} else {
  // Everything for the latest period is collected — advance to generate next.
  targetPeriod = nextPeriodId || currentPeriodId;
}
    const [y, m] = targetPeriod.split("-").map(Number);
    setBillYear(y);
    setBillMonth(m - 1); // convert to 0-indexed
  }, [latestPeriodData, billMonth]);
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
  const allMembers = membersData?.members || [];
  const periodLabel =
    billMonth !== null && billYear
      ? `${billYear}-${String(billMonth + 1).padStart(2, "0")}`
      : "...";
  const generatePreview = async () => {
    if (billMonth === null || billYear === null) return;
    const members = allMembers.filter((m) => !m.isDeleted);
    setIsPreviewing(true);
    setPreviewProgress({ current: 0, total: members.length });
    await new Promise((r) => setTimeout(r, 50));
    setPreviewProgress({ current: 0, total: 0, label: "fetching" });
    await new Promise((r) => setTimeout(r, 50));
    try {
      const society = societyData?.society || {};
      const config = society.config || {};
      const heads = billingHeadsData?.heads || [];
      // Build parking rates from billing heads (source of truth), not society config
      const parkingRates = buildParkingRates(heads);
      const interestRate = parseFloat(config.interestRate) || 0;
      const interestAfterDays = config.interestAfterDays ?? 15;
      const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;
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
        const principalBase = prevData.principalBalance ?? 0;
        const remInt = prevData.remInt ?? 0;
        const currInt = computeMonthlyInterest(principalBase, interestRate);
        const interestAmount = parseFloat((remInt + currInt).toFixed(2));
        const {
          charges: activeCharges,
          subtotal,
          serviceTax,
          currentBillTotal,
        } = computeCurrentCharges(member, heads, parkingRates, serviceTaxRate);
        const memberParkingCharges = (member.parkingSlots || [])
          .filter((s) => s.type !== "Stilt" && s.monthlyBilling !== false)
          .reduce(
            (sum, slot) =>
              sum + (parkingRates[`${slot.type}-${slot.vehicleType}`] ?? 0),
            0,
          );
        const advanceCredit = prevData.advanceCredit || 0;
        const { grandTotal: grandTotalRounded } = computeBillTotal({
          principalOutstanding: principalBase,
          interestOutstanding: remInt,
          currInt,
          currentBillTotal,
          advanceCredit,
        });
        preview.push({
          memberId,
          member: `${member.wing || ""}-${flatNo}`,
          memberName: member.ownerName || "Unknown",
          memberContact: member.contact || "",
          area,
          advanceCredit,
          parkingCharges: memberParkingCharges,
          previousBalance: prevData.balance || 0,
          previousBalanceDays: 0,
          lastBillDate: null,
          unpaidBills: prevData.unpaidBills || [],
          recentTransactions: prevData.recentTransactions || [],
          interestRate,
          interestAfterDays,
          prevRemPrincipal: principalBase,
          prevRemInt: remInt,
          currInt,
          interestAmount: Math.round(interestAmount * 100) / 100,
          charges: activeCharges,
          subtotal,
          serviceTax,
          serviceTaxRate,
          currentBillTotal,
          grandTotal: grandTotalRounded,
        });
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
      setShowPreview(true);
    } catch (err) {
      alert("Failed to build previews: " + err.message);
    } finally {
      setIsPreviewing(false);
      setPreviewProgress({ current: 0, total: 0 });
    }
  };
  const autoGenerateNextMonth = async () => {
    const nextDate = new Date(billYear, billMonth + 1, 1);
    const nextMonth = nextDate.getMonth(); // 0-indexed
    const nextYear = nextDate.getFullYear();
    const nextPeriodLabel = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}`;
    const currentPeriodLabel = `${billYear}-${String(billMonth + 1).padStart(2, "0")}`;
    const interestAfterDays = societyData?.society?.config?.interestAfterDays || 15;
    const dueDateObj = new Date(nextYear, nextMonth, 1 + interestAfterDays);
    const nextDueDate = `${dueDateObj.getFullYear()}-${String(dueDateObj.getMonth() + 1).padStart(2, "0")}-${String(dueDateObj.getDate()).padStart(2, "0")}`;
    setAutoGenState({
      status: "running",
      label: nextPeriodLabel,
      count: 0,
      error: null,
    });
    try {
      // Fetch fresh member data — user may have changed carpetArea/parking after page load
      const freshMembersRes = await apiClient.get("/api/members/list");
      queryClient.setQueryData(["members-list"], freshMembersRes);
      const members = (freshMembersRes?.members || []).filter((m) => !m.isDeleted);
      const checkRes = await apiClient.post(
        "/api/bills/get-previous-balances",
        {
          memberIds: members.map((m) => m._id).filter(Boolean),
          billMonth: billMonth + 1,
          billYear,
          billDate: `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
        },
      );
      const balances = checkRes.balances || {};
      const unpaidMembers = Object.values(balances).filter(
        (b) =>
          (b.unpaidBills || []).reduce(
            (s, u) => s + (u.balanceAmount || 0),
            0,
          ) > 0.005,
      );
      const unpaidCount = unpaidMembers.length;
      if (unpaidCount > 0) {
        const memberLines = unpaidMembers
          .map((b) => {
            const bill = b.unpaidBills[0];
            return `  • Member has Rs ${b.unpaidBills.reduce((s, u) => s + (u.balanceAmount || 0), 0).toFixed(2)} pending since ${b.unpaidBills.map((u) => u.billPeriodId).join(", ")}`;
          })
          .join("\n");
        const proceed = window.confirm(
          `${unpaidCount} member(s) have not fully paid their previous bills:\n\n${memberLines}\n\n` +
            `Their unpaid amount will be carried forward into ${nextPeriodLabel} bills and interest will be added.\n\n` +
            `OK = Generate ${nextPeriodLabel} bills now\nCancel = Go back and collect pending payments first`,
        );
        if (!proceed) {
          setAutoGenState(null);
          return;
        }
      }
      const [freshSocietyRes, freshHeadsRes] = await Promise.all([
        apiClient.get("/api/society/config"),
        apiClient.get("/api/billing-heads/list"),
      ]);
      queryClient.setQueryData(["society-config"], freshSocietyRes);
      queryClient.setQueryData(["billing-heads"], freshHeadsRes);
      const society = freshSocietyRes?.society || societyData?.society || {};
      const config = society.config || {};
      const heads = freshHeadsRes?.heads || billingHeadsData?.heads || [];
      const interestRate = parseFloat(config.interestRate) || 0;
      const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;
      const parkingRates = buildParkingRates(heads);
      const billingMonthStr = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`;
      const prevBalRes = await apiClient.post(
        "/api/bills/get-previous-balances",
        {
          memberIds: members.map((m) => m._id).filter(Boolean),
          billMonth: nextMonth + 1,
          billYear: nextYear,
          billDate: billingMonthStr,
        },
      );
      const previousBalances = prevBalRes.balances || {};
      const bills = members.map((member) => {
        const memberId = member._id;
        const prevData = previousBalances[memberId] || {
          balance: 0,
          principalBalance: 0,
          remInt: 0,
          unpaidBills: [],
          recentTransactions: [],
        };
        const principalBase = prevData.principalBalance ?? 0;
        const remInt = prevData.remInt ?? 0;
        const currInt = computeMonthlyInterest(principalBase, interestRate);
        const interestAmount = parseFloat((remInt + currInt).toFixed(2));
        const { charges, subtotal, serviceTax, currentBillTotal } =
          computeCurrentCharges(member, heads, parkingRates, serviceTaxRate);
        const advanceCredit = prevData.advanceCredit || 0;
        const { grandTotal } = computeBillTotal({
          principalOutstanding: principalBase,
          interestOutstanding: remInt,
          currInt,
          currentBillTotal,
          advanceCredit,
        });
        return {
          memberId,
          totalAmount: grandTotal,
          previousBalance: prevData.balance || 0,
          advanceCredit,
          interestAmount,
          subtotal,
          serviceTax,
          currentBillTotal,
          breakdown: Object.fromEntries(charges.map((c) => [c.name, c.amount])),
          unpaidBills: prevData.unpaidBills || [],
          recentTransactions: prevData.recentTransactions || [],
        };
      });
      const payload = {
        billMonth: nextMonth,
        billYear: nextYear,
        dueDate: nextDueDate,
        bills,
      };
      const result = await apiClient.post("/api/bills/generate-final", payload);
      const count = result.billsGenerated ?? result.count ?? 0;
      // Advance UI to next month
      setBillMonth(nextMonth);
      setBillYear(nextYear);
      setPayResults(null);
      setExcelFile(null);
      setExcelValidation(null);
      setBillGrid(null);
      setPayGrid(null);
      setBillsGeneratedForPeriod(nextPeriodLabel);
      queryClient.invalidateQueries(["bills-list"]);
      queryClient.invalidateQueries(["latest-period"]);
      setAutoGenState({
        status: "done",
        label: nextPeriodLabel,
        count,
        error: null,
      });
    } catch (err) {
      setAutoGenState({
        status: "error",
        label: null,
        count: 0,
        error: err.message,
      });
    }
  };
  const generateMutation = useMutation({
    mutationFn: async () => {
      const billsToSend = previewData || [];
      const total = billsToSend.length;
      setGenProgress({ current: 0, total });
      if (total === 0) {
        throw new Error("No preview data available");
      }
      const _dueDay = societyData?.society?.config?.interestAfterDays || 15;
      const computedDueDate = `${billYear}-${String(billMonth + 1).padStart(2, "0")}-${String(_dueDay).padStart(2, "0")}`;
      const payload = {
        billMonth,
        billYear,
        dueDate: computedDueDate,
        bills: billsToSend.map((b) => ({
          memberId: b.memberId,
          totalAmount: b.grandTotal,
          previousBalance: b.previousBalance || 0,
          advanceCredit: b.advanceCredit || 0,
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
      };
      let result;
      try {
        result = await apiClient.post("/api/bills/generate-final", payload);
      } catch (err) {
        if (err.status === 409 || err.message?.includes("already exist")) {
          const confirmed = window.confirm(
            `Bills for ${periodLabel} already exist.\n\nDo you want to DELETE the existing bills and regenerate?\n\nThis cannot be undone. Payments already recorded against these bills will NOT be deleted.`,
          );
          if (!confirmed) throw new Error("Generation cancelled");
          result = await apiClient.post("/api/bills/generate-final", {
            ...payload,
            forceRegenerate: true,
          });
        } else {
          throw err;
        }
      }
      setGenProgress({ current: total, total });
      return { count: result.billsGenerated ?? result.count ?? 0 };
    },
    onSuccess: (data) => {
      setGenProgress({ current: 0, total: 0 });
      alert(`Generated ${data.count} bills successfully!`);
      setShowPreview(false);
      setBillsGeneratedForPeriod(periodLabel);
      queryClient.invalidateQueries(["bills-list"]);
      queryClient.invalidateQueries(["latest-period"]);
    },
    onError: (error) => {
      alert("Failed to generate bills: " + error.message);
    },
  });
  const renderBillHTML = (billData) => {
    const template = templateData?.template;
    if (template?.type === "uploaded-pdf" && template?.pdfUrl) {
      const hasFormFields = template.hasFormFields || false;
      const fieldCount = template.detectedFields?.length || 0;
      return `
    <div style="text-align: center;">
      <div style="background: #f9fafb; padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
        <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #374151;">
          <strong>Bill will be generated using your uploaded PDF template</strong>
        </p>
        <p style="margin: 0; font-size: 0.95rem; color: #6b7280;">
          ${
            hasFormFields
              ? `Auto-detected ${fieldCount} fillable fields`
              : "Data will be overlaid on PDF"
          }
        </p>
      </div>
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
              <th style="padding: 0.75rem; text-align: right; border: 1px solid #e5e7eb; font-size: 0.875rem;">Amount (Rs)</th>
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
                Rs ${billData.currentBillTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
        ${
          Math.abs(billData.previousBalance) > 0
            ? `
          <div style="background: ${billData.previousBalance > 0 ? "#fee2e2" : "#d1fae5"}; border-left: 4px solid ${billData.previousBalance > 0 ? "#dc2626" : "#059669"}; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
            <h4 style="margin: 0 0 1rem 0; color: ${billData.previousBalance > 0 ? "#991b1b" : "#065f46"};">
              ${billData.previousBalance > 0 ? "Previous Outstanding Balance" : "Opening Balance Credit"}
            </h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
              <div>
                <div style="font-size: 0.875rem; color: ${billData.previousBalance > 0 ? "#7f1d1d" : "#065f46"}; margin-bottom: 0.5rem;">
                  ${billData.previousBalance > 0 ? "Amount Owed" : "Credit Adjustment"}
                </div>
                <div style="font-size: 1.75rem; font-weight: 700; color: ${billData.previousBalance > 0 ? "#dc2626" : "#059669"};">
                  Rs ${Math.abs(billData.previousBalance).toLocaleString("en-IN")}
                </div>
                ${
                  billData.prevRemPrincipal > 0 || billData.prevRemInt > 0
                    ? `
                <div style="font-size: 0.78rem; margin-top: 0.35rem; opacity: 0.85; line-height: 1.6;">
                  Principal: Rs ${(billData.prevRemPrincipal || 0).toFixed(2)}<br/>
                  Prev. Interest: Rs ${(billData.prevRemInt || 0).toFixed(2)}
                </div>`
                    : ""
                }
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                  <div style="font-size: 0.95rem; font-weight: 600;">Interest Charged</div>
                  <div style="font-size: 1.5rem; font-weight: 700;">Rs ${billData.interestAmount.toLocaleString("en-IN")}</div>
                </div>
                ${
                  billData.prevRemInt > 0 || billData.currInt > 0
                    ? `
                <div style="background: rgba(255,255,255,0.15); border-radius: 6px; padding: 0.6rem 0.75rem; margin-bottom: 0.5rem; font-size: 0.82rem; line-height: 1.8;">
                  ${billData.prevRemInt > 0 ? "<div>Carried unpaid interest: Rs " + billData.prevRemInt.toFixed(2) + "</div>" : ""}
                  ${billData.currInt > 0 ? "<div>New this month (Rs " + billData.prevRemPrincipal?.toFixed(2) + " x " + billData.interestRate + "% / 12): Rs " + billData.currInt.toFixed(2) + "</div>" : ""}
                  ${billData.prevRemInt > 0 && billData.currInt > 0 ? '<div style="border-top: 1px solid rgba(255,255,255,0.3); margin-top: 0.4rem; padding-top: 0.4rem;">Total: Rs ' + billData.prevRemInt.toFixed(2) + " + Rs " + billData.currInt.toFixed(2) + " = Rs " + billData.interestAmount.toFixed(2) + "</div>" : ""}
                </div>
                `
                    : ""
                }
                <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                  Rate: ${billData.interestRate}% p.a. | Formula: principal × rate / 12
                  ${billData.currInt > 0 ? "<br/>Formula: Rs " + billData.prevRemPrincipal?.toFixed(2) + " x " + billData.interestRate + "% / 12 = Rs " + billData.currInt.toFixed(2) + " (new this month)" : ""}
                </div>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }
        ${
          billData.advanceCredit > 0
            ? `
        <div style="background:#d1fae5;border:2px solid #059669;border-radius:8px;padding:1rem 1.5rem;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;color:#065f46;font-size:0.95rem;">Advance Credit Applied</div>
            <div style="font-size:0.8rem;color:#065f46;margin-top:2px;">Overpayment from previous month adjusted</div>
          </div>
          <div style="font-size:1.5rem;font-weight:700;color:#059669;">- Rs ${billData.advanceCredit.toFixed(2)}</div>
        </div>`
            : ""
        }
        <div style="background: #dbeafe; padding: 1.5rem; border-radius: 8px; border: 3px solid #1e40af; margin-bottom: 1rem;">
         <div style="display: flex; justify-content: space-between; align-items: center;">
  <div style="font-size: 1.2rem; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : "#1e40af"};">
    ${billData.grandTotal <= 0 ? "ADVANCE CREDIT BALANCE" : "TOTAL AMOUNT PAYABLE"}
  </div>
  <div style="font-size: 1.8rem; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : "#1e40af"};">
    Rs ${Math.abs(billData.grandTotal).toFixed(2)}
  </div>
</div>
${
  billData.grandTotal <= 0
    ? `
  <div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: #d1fae5; border-radius: 6px; font-size: 0.8rem; color: #065f46;">
    No payment due. Rs ${Math.abs(billData.grandTotal).toFixed(2)} credit will be adjusted in next bill.
  </div>
`
    : ""
}
          <div style="margin-top: 1rem; padding-top: 1rem; border-top: 2px solid #1e40af; font-size: 0.85rem; color: #1e40af; line-height: 1.8;">
            ${billData.previousBalance > 0 ? "Previous Balance: Rs " + billData.previousBalance.toFixed(2) + "<br/>" : ""}
            ${(billData.prevRemPrincipal || 0) > 0 ? "Principal carried: Rs " + billData.prevRemPrincipal.toFixed(2) + "<br/>" : ""}
            ${(billData.currInt || 0) > 0 ? "Interest (Rs " + billData.prevRemPrincipal.toFixed(2) + " × " + billData.interestRate + "% ÷ 12): Rs " + billData.currInt.toFixed(2) + "<br/>" : "No interest (no outstanding principal)<br/>"}
            Current charges: Rs ${billData.currentBillTotal.toFixed(2)}
            ${billData.advanceCredit > 0 ? "<br/>Advance credit: - Rs " + billData.advanceCredit.toFixed(2) : ""}
            <br/><strong>Total: Rs ${Math.abs(billData.grandTotal).toFixed(2)}</strong>
          </div>
        </div>
        <div style="background: #f9fafb; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb;">
          <p style="margin: 0; font-size: 0.875rem; color: #6b7280; text-align: center;">
            Click "Generate All Bills" to create PDF bills using your template
          </p>
        </div>
      </div>
      <div style="margin-top: 2rem; border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <div style="background: #1f2937; color: white; padding: 1rem; font-weight: 600;">
          Your PDF Template (data will be filled here)
        </div>
        <iframe
          src="${template.pdfUrl}"
          style="width: 100%; height: 800px; border: none; background: white;"
        />
      </div>
    </div>
  `;
    }
    if (template?.type === "uploaded-image" && template?.imageUrl) {
      return `
      <div style="text-align: center;">
        <div style="background: #f9fafb; padding: 2rem; border-radius: 8px; margin-bottom: 1rem;">
          <p style="margin: 0 0 1rem 0; font-size: 1.1rem; color: #374151;">
            <strong>Bill will be generated using your uploaded image template</strong>
          </p>
          <p style="margin: 0; font-size: 0.95rem; color: #6b7280;">
            Data will be overlaid on the image
          </p>
        </div>
        <div style="margin-top: 2rem; border: 2px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="background: #1f2937; color: white; padding: 1rem; font-weight: 600;">
            Your Image Template (data will be overlaid)
          </div>
          <img src="${template.imageUrl}" style="width: 100%; height: auto;" />
        </div>
      </div>
    `;
    }
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
      <div style="background: ${design.headerBg}; color: ${design.headerColor}; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
        ${logoUrl ? `<img src="${logoUrl}" style="width: 80px; margin-bottom: 15px;" />` : ""}
        <h1 style="margin: 0; font-size: ${design.societyNameSize}px;">${society.name || "Society Name"}</h1>
        <p style="margin: 5px 0 0 0; font-size: ${design.addressSize}px; opacity: 0.9;">${society.address || ""}</p>
      </div>
      <h2 style="text-align: ${design.billTitleAlign}; font-size: ${design.billTitleSize}px; margin: 0 0 20px 0; color: #1f2937;">
        MAINTENANCE BILL
      </h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 30px; padding: 20px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
        <div><strong>Bill Period:</strong> ${billYear}-${String(billMonth + 1).padStart(2, "0")}</div>
        <div><strong>Bill Date:</strong> ${new Date().toLocaleDateString("en-IN")}</div>
        <div><strong>Member:</strong> ${billData.member}</div>
        <div><strong>Due Date:</strong> ${new Date(billYear, billMonth + 1, 10).toLocaleDateString("en-IN")}</div>
        <div><strong>Name:</strong> ${billData.memberName}</div>
        <div><strong>Area:</strong> ${billData.area} sq ft</div>
      </div>
${
  Math.abs(billData.previousBalance) > 0
    ? `
        <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem;">
          <h4 style="margin: 0 0 1rem 0; color: #991b1b;">Previous Outstanding Balance</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid #fca5a5;">
            <div>
              <div style="font-size: 0.875rem; color: #7f1d1d; margin-bottom: 0.5rem;">Total Outstanding</div>
              <div style="font-size: 1.75rem; font-weight: 700; color: #dc2626;">Rs ${billData.previousBalance.toLocaleString("en-IN")}</div>
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
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: #7f1d1d; font-weight: 600;">Unpaid Bills:</h5>
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
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; font-weight: 600; color: #dc2626;">Rs ${(bill.balanceAmount ?? bill.amount ?? 0).toFixed(2)}</td>
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
              <h5 style="margin: 0 0 0.75rem 0; font-size: 0.95rem; color: #7f1d1d; font-weight: 600;">Recent Transactions:</h5>
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
                        ${txn.billPeriod ? '<br/><span style="font-size: 0.7rem; color: #7f1d1d;">(' + txn.billPeriod + ")</span>" : ""}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; color: ${txn.type === "Debit" ? "#dc2626" : "#9ca3af"}; font-weight: ${txn.type === "Debit" ? "600" : "400"};">
                        ${txn.type === "Debit" ? "Rs " + txn.amount.toFixed(2) : "-"}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; color: ${txn.type === "Credit" ? "#059669" : "#9ca3af"}; font-weight: ${txn.type === "Credit" ? "600" : "400"};">
                        ${txn.type === "Credit" ? "Rs " + txn.amount.toFixed(2) : "-"}
                      </td>
                      <td style="padding: 0.5rem; text-align: right; border: 1px solid #fca5a5; font-weight: 600; color: ${txn.balance >= 0 ? "#059669" : "#dc2626"};">
                        Rs ${txn.balance.toFixed(2)}
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
                <div style="font-size: 0.95rem; font-weight: 600;">Interest Charged</div>
                <div style="font-size: 1.5rem; font-weight: 700;">Rs ${billData.interestAmount.toLocaleString("en-IN")}</div>
              </div>
              <div style="font-size: 0.8rem; opacity: 0.9; line-height: 1.5;">
                Rate: ${billData.interestRate}% p.a.<br/>
                ${billData.prevRemInt > 0 ? "Carried interest: Rs " + billData.prevRemInt.toFixed(2) + (billData.currInt > 0 ? " | " : "") : ""}${billData.currInt > 0 ? "New this month: Rs " + billData.prevRemPrincipal?.toFixed(2) + " x " + billData.interestRate + "% / 12 = Rs " + billData.currInt.toFixed(2) : ""}
              </div>
            </div>
          `
              : ""
          }
        </div>
      `
    : ""
}
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #374151; font-weight: 600;">Current Month Charges</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: ${design.tableHeaderBg}; color: ${design.tableHeaderColor};">
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Sr.</th>
            <th style="padding: 12px; text-align: left; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Particulars</th>
            <th style="padding: 12px; text-align: center; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Calculation</th>
            <th style="padding: 12px; text-align: right; border: 1px solid ${design.tableBorderColor}; font-size: 13px;">Amount (Rs)</th>
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
              Rs ${billData.currentBillTotal.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
      <div style="background: ${design.totalBg}; padding: 25px; border-radius: 8px; margin-bottom: 30px; border: 3px solid ${design.totalColor};">
        <div style="margin-bottom: 15px;">
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">Calculation:</div>
          <div style="font-size: 13px; color: #374151; line-height: 1.6;">
${
  Math.abs(billData.previousBalance) > 0
    ? `
              <div>Previous Balance: <strong>Rs ${billData.previousBalance.toFixed(2)}</strong></div>
            `
    : ""
}
            ${
              billData.interestAmount > 0
                ? `
              <div>Interest: <strong>+Rs ${billData.interestAmount.toFixed(2)}</strong></div>
            `
                : ""
            }
            <div>Current Bill: <strong>+Rs ${billData.currentBillTotal.toFixed(2)}</strong></div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 15px; border-top: 2px solid ${billData.grandTotal <= 0 ? "#059669" : design.totalColor};">
  <div style="font-size: 16px; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : design.totalColor};">
    ${billData.grandTotal <= 0 ? "ADVANCE CREDIT BALANCE" : "TOTAL AMOUNT PAYABLE"}
  </div>
  <div style="font-size: ${design.totalSize}px; font-weight: 700; color: ${billData.grandTotal <= 0 ? "#059669" : design.totalColor};">
    Rs ${Math.abs(billData.grandTotal).toFixed(2)}
  </div>
</div>
${
  billData.grandTotal <= 0
    ? `
  <div style="margin-top: 10px; padding: 8px 12px; background: #d1fae5; border-radius: 6px; font-size: 11px; color: #065f46;">
    No payment due. Rs ${Math.abs(billData.grandTotal).toFixed(2)} credit will be adjusted in next bill.
  </div>
`
    : ""
}
      </div>
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
      <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 10px; color: #9ca3af;">
        Generated on ${new Date().toLocaleString("en-IN")} | Computer Generated Bill
      </div>
    </div>
  `;
  };
  const currentBill = previewData?.[previewIndex];
  const billTemplateDisabled =
    billMonth === null ||
    billYear === null;
  const downloadBillTemplate = async () => {
    if (billMonth === null || billYear === null) return;
    try {
      const memberIdsParam = allMembers.map((m) => m._id).join(",");
      const res = await fetch(
        `/api/billing/excel-template?month=${billMonth + 1}&year=${billYear}&memberIds=${encodeURIComponent(memberIdsParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BillTemplate_${periodLabel}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + e.message);
    }
  };
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Generate Bills</h1>
          <p>
            {latestPeriodLoading
              ? "Detecting billing period..."
              : billMonth !== null && billYear
                ? (() => {
                    const { currentGenerated, allPaid, latestPeriodId } =
                      latestPeriodData || {};
                    if (!latestPeriodId)
                      return `No bills generated yet — starting with ${periodLabel}`;
                    if (!currentGenerated)
                      return `${latestPeriodId} bills exist — generating ${periodLabel}`;
                    if (allPaid)
                      return `Payments collected — ready for ${periodLabel}`;
                    if (latestPeriodId < (latestPeriodData?.currentPeriodId || ""))
                      return `${latestPeriodId} has partial payments — generating next period ${periodLabel}`;
                    return `Bills generated for ${latestPeriodId} — collect payments or generate ${periodLabel}`;
                  })()
                : "Detecting billing period..."}
          </p>
        </div>
      </div>
      {membersData?.members && (
        <div className={styles.statsBanner}>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>
              {membersData.members.length}
            </div>
            <div className={styles.statLabel}>Total Members</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber}>
              {billingHeadsData?.heads?.length || 0}
            </div>
            <div className={styles.statLabel}>Billing Heads</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statNumber} style={{ fontSize: "1.1rem" }}>
              {periodLabel}
            </div>
            <div className={styles.statLabel}>Active Period</div>
          </div>
        </div>
      )}
      {/* ── TEST CONFIG PANEL (temporary) ──────────────────────────────── */}
      <TestConfigPanel
        members={allMembers}
        periodLabel={periodLabel}
        onSaved={() => queryClient.invalidateQueries(["members-list"])}
      />
      {/* UNIFIED TEMPLATE SECTION */}
      <div
        style={{
          background: "#fff",
          border: "2px solid #c7d2fe",
          borderRadius: "12px",
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "#eef2ff",
            padding: "1rem 1.5rem",
            borderBottom: "1px solid #c7d2fe",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#3730a3" }}>
            Unified Template - Bill Generation & Payment Collection
          </h2>
          <p
            style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#6366f1" }}
          >
            Download then review charge columns then optionally fill
            AmountPaid/Method/Date then upload and system detects what to do
          </p>
        </div>
        <div style={{ padding: "1.5rem" }}>
          {/* Download */}
          <div
            style={{
              background: "#f5f3ff",
              border: "1px solid #ddd6fe",
              borderRadius: "10px",
              padding: "1.25rem",
              marginBottom: "1.5rem",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.5rem",
                fontSize: "0.95rem",
                color: "#4338ca",
              }}
            >
              Step 1 - Download Unified Template
            </h3>
            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.8rem",
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              Pre-filled with opening balances, charge heads, interest, bill
              totals. Leave{" "}
              <strong>AmountPaid / PaymentMethod / PaymentDate</strong> blank
              for bill-only generation, or fill them to also record payments in
              the same upload.
            </p>
            <div
              style={{
                fontSize: "0.78rem",
                color: "#3730a3",
                background: "#ede9fe",
                borderRadius: "6px",
                padding: "0.5rem 0.75rem",
                marginBottom: "1rem",
              }}
            >
              <strong>Columns:</strong> Wing-FlatNo - OwnerName - Period -
              CurrentCharges -{" "}
              {billingHeadsData?.heads
                ?.filter((h) => h.isActive && !h.isDeleted)
                .map((h) => h.headName)
                .join(" - ")}{" "}
              - OpeningPrincipal - OpeningInterest - CurrentInterest -
              BillPrincipal - BillInterest - TotalBillDue - AlreadyPaid -
              AdvanceCredit - RemainingDue -{" "}
              <strong>AmountPaid - PaymentMethod - PaymentDate</strong> -
              Remarks
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                disabled={billTemplateDisabled}
                onClick={downloadBillTemplate}
                style={{ opacity: billTemplateDisabled ? 0.5 : 1 }}
              >
                Download Template ({periodLabel})
              </button>
              <button
                className="btn btn-secondary"
                disabled={isPreviewing}
                onClick={generatePreview}
                style={{ fontSize: "0.875rem" }}
              >
                {isPreviewing ? (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <span className="loading-spinner" />
                    {previewProgress.label === "fetching"
                      ? "Fetching balances..."
                      : `Calculating ${previewProgress.current}/${previewProgress.total}`}
                  </span>
                ) : (
                  "Preview Bills"
                )}
              </button>
            </div>
          </div>
          {/* Upload */}
          <div
            style={{
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "1.25rem",
            }}
          >
            <h3
              style={{
                margin: "0 0 0.5rem",
                fontSize: "0.95rem",
                color: "#374151",
              }}
            >
              Step 2 - Upload Filled Template
            </h3>
            <p
              style={{
                margin: "0 0 1rem",
                fontSize: "0.8rem",
                color: "#6b7280",
                lineHeight: 1.5,
              }}
            >
              Upload the template after filling it. System auto-detects:
              <br />- <strong>AmountPaid blank</strong> then validate charges
              and generate bills
              <br />- <strong>AmountPaid filled</strong> then validate both and
              generate bills plus record payments (or choose)
            </p>
            {/* File upload */}
            <DropZone
              accept=".xlsx,.xls"
              file={excelFile}
              onFile={(f) => {
                setExcelFile(f);
                setPayGrid(null);
                setPayPreview(null);
                setPayBatchKey(null);
                runValidation(f);
              }}
              onClear={() => {
                setExcelFile(null);
                setExcelValidation(null);
                setBillGrid(null);
                setPayGrid(null);
                setApprovedDiffs(new Set());
                setPayPreview(null);
                setPayBatchKey(null);
              }}
              label="Click or drag & drop Unified Template here"
              hint=".xlsx or .xls — max 5MB"
              style={{ marginBottom: "1rem" }}
            />
            {/* Auto-validating spinner */}
            {excelValidating && (
              <div
                style={{
                  textAlign: "center",
                  padding: "1rem",
                  color: "#6b7280",
                }}
              >
                Validating...
              </div>
            )}
            {/* Bill grid preview */}
            {billGrid && (
              <ExcelPreviewGrid
                title={`Template Preview - ${periodLabel}`}
                columns={billGrid.columns}
                rows={billGrid.gridRows}
                onReupload={() => {
                  setExcelFile(null);
                  setExcelValidation(null);
                  setBillGrid(null);
                  setApprovedDiffs(new Set());
                }}
                onContinue={(validRows) => {}}
                onCancel={() => {
                  setExcelFile(null);
                  setExcelValidation(null);
                  setBillGrid(null);
                  setApprovedDiffs(new Set());
                }}
              />
            )}
            {/* Validation results */}
            {excelValidation && (
              <div style={{ marginTop: "1.5rem" }}>
                {/* Summary badges */}
                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    marginBottom: "1rem",
                  }}
                >
                  {[
                    ["Errors", "#dc2626", excelValidation.errorCount],
                    ["Warnings", "#d97706", excelValidation.warningCount],
                    ["Duplicates", "#7c3aed", excelValidation.duplicateCount],
                  ].map(([l, c, v]) => (
                    <div
                      key={l}
                      style={{
                        textAlign: "center",
                        padding: "0.75rem",
                        borderRadius: "8px",
                        background: "white",
                        border: `2px solid ${c}`,
                      }}
                    >
                      <div
                        style={{
                          fontSize: "1.5rem",
                          fontWeight: 700,
                          color: c,
                        }}
                      >
                        {v}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                        {l}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Issues list */}
                {excelValidation.issues?.filter((i) => i.type !== "diff")
                  .length > 0 && (
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.8rem",
                      marginBottom: "1rem",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#fca5a5" }}>
                        {["Row", "Type", "What went wrong", "How to fix"].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                padding: "6px 10px",
                                textAlign: "left",
                                border: "1px solid #fca5a5",
                              }}
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {excelValidation.issues
                        .filter((i) => i.type !== "diff")
                        .map((issue, i) => (
                          <tr
                            key={i}
                            style={{
                              background: i % 2 === 0 ? "#fff" : "#fef9f9",
                            }}
                          >
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                                fontWeight: 600,
                              }}
                            >
                              {issue.row ?? "-"}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                              }}
                            >
                              <span
                                style={{
                                  background:
                                    issue.type === "error"
                                      ? "#dc2626"
                                      : issue.type === "warning"
                                        ? "#d97706"
                                        : "#7c3aed",
                                  color: "white",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  fontSize: "0.75rem",
                                }}
                              >
                                {issue.type}
                              </span>
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                              }}
                            >
                              {issue.message}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: "1px solid #fca5a5",
                                color: "#059669",
                              }}
                            >
                              {issue.fix}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
                {/* Diff approvals */}
                {diffIssues.length > 0 && (
                  <div
                    style={{
                      background: "#fff7ed",
                      border: "2px solid #f97316",
                      borderRadius: "10px",
                      padding: "1.25rem",
                      marginBottom: "1.5rem",
                    }}
                  >
                    <h4
                      style={{
                        margin: "0 0 0.75rem",
                        color: "#9a3412",
                        fontSize: "0.95rem",
                        fontWeight: 700,
                      }}
                    >
                      {diffIssues.length} Amount Mismatch
                      {diffIssues.length > 1 ? "es" : ""} - Must Approve Each
                    </h4>
                    {diffIssues.map((issue, i) => (
                      <div
                        key={i}
                        style={{
                          background: approvedDiffs.has(issue.memberId)
                            ? "#f0fdf4"
                            : "#fff",
                          border: `2px solid ${approvedDiffs.has(issue.memberId) ? "#86efac" : "#f97316"}`,
                          borderRadius: "8px",
                          padding: "1rem",
                          marginBottom: "0.75rem",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: "1rem",
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#7c2d12",
                                fontSize: "0.95rem",
                                marginBottom: "0.5rem",
                              }}
                            >
                              {issue.flat} - {issue.name}
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr 1fr",
                                gap: "0.5rem",
                                marginBottom: "0.75rem",
                              }}
                            >
                              {[
                                [
                                  "Excel Total",
                                  `Rs ${issue.excelTotal}`,
                                  "#dc2626",
                                ],
                                [
                                  "System Calc",
                                  `Rs ${issue.autoTotal}`,
                                  "#059669",
                                ],
                                [
                                  "Difference",
                                  `Rs ${issue.diff > 0 ? "+" : ""}${issue.diff}`,
                                  issue.diff < 0 ? "#dc2626" : "#d97706",
                                ],
                              ].map(([l, v, c]) => (
                                <div
                                  key={l}
                                  style={{
                                    background: "#f9fafb",
                                    borderRadius: "6px",
                                    padding: "0.5rem",
                                    textAlign: "center",
                                    border: "1px solid #e5e7eb",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "0.7rem",
                                      color: "#6b7280",
                                      marginBottom: "2px",
                                    }}
                                  >
                                    {l}
                                  </div>
                                  <div
                                    style={{
                                      fontWeight: 700,
                                      color: c,
                                      fontSize: "1rem",
                                    }}
                                  >
                                    {v}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#92400e",
                                background: "#fef3c7",
                                borderRadius: "6px",
                                padding: "0.5rem 0.75rem",
                              }}
                            >
                              {issue.why} - {issue.fix}
                            </div>
                          </div>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: "0.35rem",
                              cursor: "pointer",
                              minWidth: 60,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={approvedDiffs.has(issue.memberId)}
                              onChange={(e) =>
                                setApprovedDiffs((prev) => {
                                  const next = new Set(prev);
                                  e.target.checked
                                    ? next.add(issue.memberId)
                                    : next.delete(issue.memberId);
                                  return next;
                                })
                              }
                              style={{
                                width: 20,
                                height: 20,
                                cursor: "pointer",
                                accentColor: "#059669",
                              }}
                            />
                            <span
                              style={{
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                color: approvedDiffs.has(issue.memberId)
                                  ? "#059669"
                                  : "#dc2626",
                              }}
                            >
                              {approvedDiffs.has(issue.memberId)
                                ? "APPROVED"
                                : "APPROVE?"}
                            </span>
                          </label>
                        </div>
                      </div>
                    ))}
                    {!allDiffsApproved && (
                      <div
                        style={{
                          background: "#fef2f2",
                          border: "1px solid #fca5a5",
                          borderRadius: "8px",
                          padding: "0.75rem",
                          marginTop: "0.5rem",
                          fontSize: "0.8rem",
                          color: "#991b1b",
                          fontWeight: 600,
                          textAlign: "center",
                        }}
                      >
                        Generate blocked - approve all{" "}
                        {diffIssues.length - approvedDiffs.size} remaining
                        mismatch
                        {diffIssues.length - approvedDiffs.size > 1
                          ? "es"
                          : ""}{" "}
                        to unlock
                      </div>
                    )}
                  </div>
                )}
                {/* Matched rows */}
                {excelValidation.comparison?.filter((r) => !r.hasDiff).length >
                  0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <h4
                      style={{
                        margin: "0 0 0.75rem",
                        color: "#374151",
                        fontSize: "0.95rem",
                        fontWeight: 700,
                      }}
                    >
                      Matched Rows (
                      {
                        excelValidation.comparison.filter((r) => !r.hasDiff)
                          .length
                      }
                      )
                    </h4>
                    <div
                      style={{
                        overflowX: "auto",
                        maxHeight: 260,
                        overflowY: "auto",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "0.8rem",
                        }}
                      >
                        <thead
                          style={{
                            position: "sticky",
                            top: 0,
                            background: "#d1fae5",
                            zIndex: 1,
                          }}
                        >
                          <tr>
                            {[
                              "Flat",
                              "Member",
                              "Excel Total",
                              "Auto Total",
                              "Status",
                            ].map((h) => (
                              <th
                                key={h}
                                style={{
                                  padding: "8px 10px",
                                  border: "1px solid #a7f3d0",
                                  fontWeight: 700,
                                  color: "#065f46",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {excelValidation.comparison
                            .filter((r) => !r.hasDiff)
                            .map((row, i) => (
                              <tr
                                key={i}
                                style={{
                                  background: i % 2 === 0 ? "#fff" : "#f0fdf4",
                                }}
                              >
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    fontWeight: 600,
                                  }}
                                >
                                  {row.flat}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                  }}
                                >
                                  {row.name}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    textAlign: "right",
                                  }}
                                >
                                  Rs {row.excelTotal}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    textAlign: "right",
                                  }}
                                >
                                  Rs {row.autoTotal}
                                </td>
                                <td
                                  style={{
                                    padding: "6px 10px",
                                    border: "1px solid #d1fae5",
                                    textAlign: "center",
                                  }}
                                >
                                  <span
                                    style={{
                                      background: "#059669",
                                      color: "white",
                                      padding: "2px 8px",
                                      borderRadius: "4px",
                                      fontSize: "0.75rem",
                                    }}
                                  >
                                    Match
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* Action buttons */}
                {(() => {
                  const isPaymentOnly =
                    excelValidation.uploadMode === "PAYMENT_ONLY";
                  const hasPayments = excelValidation.hasPaymentData;
                  const hasErrors = (excelValidation.errorCount || 0) > 0;
                  const doGenerateBills = async () => {
                    setExcelImporting(true);
                    try {
                      const res = await fetch(
                        "/api/billing/generate-from-excel",
                        {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            bills: excelValidation.bills,
                            billMonth,
                            billYear,
                          }),
                        },
                      );
                      const data = await res.json();
                      if (!data.success)
                        throw new Error(data.error || "Generation failed");
                      queryClient.invalidateQueries(["bills-list"]);
                      return data.count;
                    } finally {
                      setExcelImporting(false);
                    }
                  };
                  const doPaymentPreview = async () => {
                    const fd = new FormData();
                    fd.append("file", excelFile);
                    const payRes = await fetch(
                      "/api/billing/upload-payments?action=preview",
                      { method: "POST", credentials: "include", body: fd },
                    );
                    const payData = await payRes.json();
                    if (!payData.success)
                      throw new Error(
                        payData.error || "Payment preview failed",
                      );
                    setPayPreview(payData);
                    setPayBatchKey(payData.batchKey);
                    if (payData.gridRows && payData.gridColumns)
                      setPayGrid({
                        gridRows: payData.gridRows,
                        columns: payData.gridColumns,
                      });
                  };
                  return (
                    <div
                      style={{
                        display: "flex",
                        gap: "0.75rem",
                        alignItems: "center",
                        borderTop: "2px solid #e5e7eb",
                        paddingTop: "1.25rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setExcelFile(null);
                          setExcelValidation(null);
                          setBillGrid(null);
                          setApprovedDiffs(new Set());
                        }}
                      >
                        Re-upload
                      </button>
                      {isPaymentOnly &&
                        // Bills already exist — payment-only mode
                        (hasPayments ? (
                          <button
                            className="btn btn-success"
                            disabled={excelImporting || hasErrors}
                            style={{ opacity: hasErrors ? 0.5 : 1 }}
                            onClick={async () => {
                              setExcelImporting(true);
                              try {
                                await doPaymentPreview();
                              } catch (e) {
                                alert("Failed: " + e.message);
                              } finally {
                                setExcelImporting(false);
                              }
                            }}
                          >
                            {excelImporting
                              ? "Loading..."
                              : `💳 Preview Payments (${excelValidation.validCount} rows)`}
                          </button>
                        ) : (
                          <div
                            style={{
                              fontSize: "0.85rem",
                              color: "#6b7280",
                              padding: "0.5rem",
                            }}
                          >
                            Bills already generated. Fill
                            AmountPaid/PaymentMethod/PaymentDate then re-upload
                            to record payments.
                          </div>
                        ))}
                      {!isPaymentOnly && (
                        <>
                          <button
                            className={`btn ${canGenerate ? "btn-success" : "btn-secondary"}`}
                            style={{
                              opacity: canGenerate ? 1 : 0.5,
                              cursor: canGenerate ? "pointer" : "not-allowed",
                            }}
                            disabled={!canGenerate || excelImporting}
                            onClick={async () => {
                              setExcelImporting(true);
                              try {
                                const count = await doGenerateBills();
                                alert(`${count} bills generated.`);
                                setBillsGeneratedForPeriod(periodLabel);
                                setExcelFile(null);
                                setExcelValidation(null);
                              } catch (e) {
                                alert("Failed: " + e.message);
                              } finally {
                                setExcelImporting(false);
                              }
                            }}
                          >
                            {excelImporting
                              ? "Generating..."
                              : !canGenerate
                                ? `Approve ${diffIssues.length - approvedDiffs.size} diff(s) first`
                                : `Generate ${excelValidation.validCount} Bills`}
                          </button>
                          {hasPayments && canGenerate && (
                            <button
                              className="btn btn-primary"
                              disabled={excelImporting}
                              onClick={async () => {
                                setExcelImporting(true);
                                try {
                                  const count = await doGenerateBills();
                                  setBillsGeneratedForPeriod(periodLabel);
                                  await doPaymentPreview();
                                  alert(
                                    `${count} bills generated. Confirm payments below.`,
                                  );
                                  queryClient.invalidateQueries(["bills-list"]);
                                } catch (e) {
                                  alert("Failed: " + e.message);
                                } finally {
                                  setExcelImporting(false);
                                }
                              }}
                            >
                              {excelImporting
                                ? "Processing..."
                                : `Generate Bills + Record Payments`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            {/* Payment preview grid */}
            {payGrid && (
              <div style={{ marginTop: "1.5rem" }}>
                <ExcelPreviewGrid
                  title={`Payment Preview - ${periodLabel}`}
                  columns={payGrid.columns}
                  rows={payGrid.gridRows}
                  onReupload={() => {
                    setExcelFile(null);
                    setPayPreview(null);
                    setPayBatchKey(null);
                    setPayGrid(null);
                  }}
                  onContinue={() => {}}
                  onCancel={() => {
                    setExcelFile(null);
                    setPayPreview(null);
                    setPayBatchKey(null);
                    setPayGrid(null);
                  }}
                />
              </div>
            )}
            {/* Payment confirmation */}
            {payPreview && payBatchKey && (
              <div
                style={{
                  marginTop: "1.5rem",
                  background: "#f0fdf4",
                  border: "1px solid #86efac",
                  borderRadius: "10px",
                  padding: "1.25rem",
                }}
              >
                <h4 style={{ margin: "0 0 0.75rem", color: "#166534" }}>
                  Payment Batch Ready
                </h4>
                <div
                  style={{
                    fontSize: "0.875rem",
                    color: "#166534",
                    marginBottom: "1rem",
                  }}
                >
                  {payPreview.validRows} valid payments - Rs{" "}
                  {payPreview.totalAmount?.toFixed(2)} total
                  {payPreview.warningRows > 0 &&
                    ` - ${payPreview.warningRows} warnings`}
                </div>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    className="btn btn-success"
                    disabled={payConfirming}
                    onClick={async () => {
                      if (
                        !confirm(
                          `Process ${payPreview.validRows} payment(s) totalling Rs ${payPreview.totalAmount?.toFixed(2)}? This cannot be undone.`,
                        )
                      )
                        return;
                      setPayConfirming(true);
                      try {
                        const res = await fetch(
                          "/api/billing/upload-payments?action=confirm",
                          {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ batchKey: payBatchKey }),
                          },
                        );
                        const data = await res.json();
                        if (!data.success)
                          throw new Error(data.error || "Confirm failed");
                        setPayResults(data);
                        setPayPreview(null);
                        setPayBatchKey(null);
                        setExcelFile(null);
                        setExcelValidation(null);
                      } catch (e) {
                        alert("Payment processing failed: " + e.message);
                      } finally {
                        setPayConfirming(false);
                      }
                    }}
                  >
                    {payConfirming
                      ? "Processing..."
                      : "Confirm & Record Payments"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setPayPreview(null);
                      setPayBatchKey(null);
                      setPayGrid(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {/* Payment results */}
            {payResults && (
              <div style={{ marginTop: "1.5rem" }}>
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 8,
                    padding: "1rem",
                    marginBottom: "1rem",
                  }}
                >
                  <strong style={{ color: "#166534" }}>
                    Payments Processed
                  </strong>
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.875rem",
                      color: "#166534",
                    }}
                  >
                    {payResults.successRows} succeeded · {payResults.failedRows} failed · Total ₹{(payResults.totalAmountProcessed || 0).toFixed(2)} · Interest cleared ₹{(payResults.totalInterestCleared || 0).toFixed(2)} · Principal cleared ₹{(payResults.totalPrincipalCleared || 0).toFixed(2)}
                  </div>
                  {payResults.results?.filter(r => r.status === "Failed").map((r, i) => (
                    <div key={i} style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "#fee2e2", borderRadius: 6, fontSize: "0.8rem", color: "#991b1b" }}>
                      ❌ {r.flat} ({r.memberName}): {r.errorMessage}
                    </div>
                  ))}
                </div>
                <div
                  style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
                >
                  <button
                    className="btn btn-secondary"
                    onClick={() => setPayResults(null)}
                  >
                    Upload Another Batch
                  </button>
                </div>
              </div>
            )}
            {/* Auto-generate next month — always visible once a period is loaded */}
            {billMonth !== null && billYear && (
              <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8 }}>
                <div style={{ fontSize: "0.82rem", color: "#1e40af", fontWeight: 600, marginBottom: "0.75rem" }}>
                  Next Month Generation
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    className="btn btn-primary"
                    disabled={autoGenState?.status === "running"}
                    onClick={() => {
                      setAutoGenState(null);
                      autoGenerateNextMonth();
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    {autoGenState?.status === "running"
                      ? "Generating..."
                      : `Auto-Generate ${new Date(billYear, billMonth + 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" })} Bills`}
                  </button>
                  {autoGenState?.status === "done" && (
                    <span style={{ color: "#16a34a", fontWeight: 600, fontSize: 14 }}>
                      ✅ {autoGenState.count} bills generated for {autoGenState.label}
                    </span>
                  )}
                  {autoGenState?.status === "error" && (
                    <span style={{ color: "#dc2626", fontSize: 13 }}>
                      ❌ {autoGenState.error}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Preview Modal */}
      {showPreview && previewData && currentBill && (
        <div className={styles.modal}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalHeader}>
                  <h2>Bill Preview - {currentBill.member}</h2>
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
                      Has Outstanding: Rs
                      {currentBill.previousBalance.toLocaleString("en-IN")}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className={styles.closeBtn}
              >
                X
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
                  Previous
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
                  Next
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
                  `Generate Bills for ${previewData?.length ?? 0} Members`
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
