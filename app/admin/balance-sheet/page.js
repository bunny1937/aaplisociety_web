"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

async function fetchBalanceSheet(fy) {
  const res = await fetch(`/api/billing/balance-sheet?fy=${fy}`, { credentials: "include" });
  if (!res.ok) throw new Error((await res.json()).error || "Failed");
  return res.json();
}

const currentFY = () => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};

const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + "%" : "—");

const ENTRY_TYPES = ["Maintenance", "Sinking Fund", "Repair & Maintenance", "Other Income", "Other Expense"];

// ── Style helpers ─────────────────────────────────────────────────────────────
const S = {
  page: { padding: "2rem", maxWidth: 1400, margin: "0 auto", color: "#1e293b", fontFamily: "system-ui, sans-serif" },
  heading: { fontSize: "1.5rem", fontWeight: 800, margin: 0, color: "#0f172a" },
  sub: { color: "#64748b", fontSize: "0.85rem", marginTop: 4, margin: 0 },
  select: { padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#1e293b", fontSize: "0.88rem" },
  sectionTitle: { fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94a3b8", marginBottom: "0.75rem" },
  card: (accent, bg = "#fff") => ({
    background: bg,
    border: `1px solid ${accent}30`,
    borderTop: `3px solid ${accent}`,
    borderRadius: 10,
    padding: "1rem 1.25rem",
  }),
  cardLabel: { color: "#64748b", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 },
  cardValue: (color) => ({ color, fontSize: "1.45rem", fontWeight: 800, lineHeight: 1.2 }),
  cardSub: { color: "#94a3b8", fontSize: "0.7rem", marginTop: 3 },
  panel: (border, bg) => ({ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "1.25rem" }),
  panelHead: (color) => ({ margin: "0 0 0.75rem", fontSize: "0.95rem", fontWeight: 700, color }),
  divRow: (border) => ({ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: `1px solid ${border}`, fontSize: "0.83rem" }),
  badge: (color, bg) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: "0.68rem", fontWeight: 700, color, background: bg }),
  th: { padding: "8px 12px", textAlign: "left", color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" },
  td: { padding: "8px 12px", borderBottom: "1px solid #f1f5f9", fontSize: "0.82rem", verticalAlign: "middle" },
  input: { width: "100%", padding: "0.5rem 0.7rem", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#1e293b", fontSize: "0.85rem", boxSizing: "border-box" },
};

function StatusBadge({ row }) {
  if (row.isOpeningMonth) return <span style={S.badge("#7c3aed", "#ede9fe")}>Opening Balance</span>;
  if (!row.generated) return <span style={S.badge("#64748b", "#f1f5f9")}>Not Generated</span>;
  if (row.allPaid) return <span style={S.badge("#16a34a", "#dcfce7")}>✓ Fully Paid</span>;
  if (row.partial) return <span style={S.badge("#d97706", "#fef3c7")}>Partial ({row.paidCount}/{row.billCount})</span>;
  return <span style={S.badge("#dc2626", "#fee2e2")}>Unpaid ({row.unpaidCount}/{row.billCount})</span>;
}

function ClosingPanel({ closing, summary, fy }) {
  if (!closing) return null;
  const { scenario, firstGenerated, lastGenerated, lastFullyPaid, nextToGenerate, marchStatus } = closing;

  // Colors per scenario
  const scenarioConfig = {
    NO_BILLS: { color: "#64748b", bg: "#f8fafc", border: "#e2e8f0", icon: "📭", label: "No Bills Generated" },
    MID_YEAR: { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "📅", label: "Mid-Year — FY In Progress" },
    MARCH_GENERATED_UNPAID: { color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "⚠️", label: "March Generated — Payment Pending" },
    MARCH_PAID: { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", icon: "✅", label: "Financial Year Closed" },
  };
  const sc = scenarioConfig[scenario] || scenarioConfig.NO_BILLS;

  return (
    <div style={{ background: sc.bg, border: `1px solid ${sc.border}`, borderLeft: `4px solid ${sc.color}`, borderRadius: 10, padding: "1.5rem", marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: sc.color, marginBottom: 6 }}>
            {sc.icon} FY Closing Status
          </div>
          <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>{sc.label}</div>

          {scenario === "NO_BILLS" && (
            <p style={{ color: "#64748b", fontSize: "0.85rem", margin: 0 }}>No bills generated for FY {fy}–{fy + 1} yet. Generate April {fy} bills to begin.</p>
          )}

          {scenario === "MID_YEAR" && (
            <div style={{ fontSize: "0.85rem", color: "#1e40af" }}>
              <div>FY started <strong>Apr {fy}</strong></div>
              {firstGenerated && <div style={{ marginTop: 4 }}>Billing journey started from: <strong>{firstGenerated.label}</strong></div>}
              {lastFullyPaid && (
                <div style={{ marginTop: 4 }}>
                  Payments confirmed up to: <strong style={{ color: "#16a34a" }}>{lastFullyPaid.label}</strong>
                </div>
              )}
              {lastGenerated && !lastGenerated.allPaid && (
                <div style={{ marginTop: 4 }}>
                  Last generated: <strong>{lastGenerated.label}</strong> —{" "}
                  <span style={{ color: "#dc2626" }}>₹{lastGenerated.totalPending?.toLocaleString("en-IN")} pending</span>
                </div>
              )}
              {nextToGenerate && (
                <div style={{ marginTop: 4 }}>Next to generate: <strong>{nextToGenerate.label}</strong></div>
              )}
              <div style={{ marginTop: 4 }}>Goal: Generate &amp; collect through <strong>Mar {fy + 1}</strong> to close FY</div>
            </div>
          )}

          {scenario === "MARCH_GENERATED_UNPAID" && marchStatus && (
            <div style={{ fontSize: "0.85rem", color: "#92400e" }}>
              <div>March {fy + 1} bill generated — financial year closing is <strong style={{ color: "#dc2626" }}>PENDING</strong></div>
              <div style={{ marginTop: 6, display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>Billed: <strong>{fmt(marchStatus.totalBilled)}</strong></div>
                <div>Collected: <strong style={{ color: "#16a34a" }}>{fmt(marchStatus.totalPaid)}</strong></div>
                <div>Outstanding: <strong style={{ color: "#dc2626" }}>{fmt(marchStatus.totalPending)}</strong></div>
                <div>Members paid: <strong>{marchStatus.paidCount}/{marchStatus.billCount}</strong></div>
              </div>
              <div style={{ marginTop: 6, padding: "0.5rem 0.75rem", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, color: "#92400e", fontSize: "0.8rem" }}>
                ⚠️ {marchStatus.unpaidCount} member(s) have not paid March dues. Collect payments and upload to close FY {fy}–{fy + 1}.
              </div>
            </div>
          )}

          {scenario === "MARCH_PAID" && marchStatus && (
            <div style={{ fontSize: "0.85rem", color: "#14532d" }}>
              <div>All March {fy + 1} bills cleared — FY <strong>{fy}–{fy + 1} fully closed</strong></div>
              <div style={{ marginTop: 6, display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                <div>Total collected: <strong style={{ color: "#16a34a" }}>{fmt(summary.totalCollected)}</strong></div>
                <div>Surplus: <strong style={{ color: "#16a34a" }}>{fmt(summary.totalCollected - summary.totalPending - (closing.priorPending || 0))}</strong></div>
              </div>
              <div style={{ marginTop: 6, padding: "0.5rem 0.75rem", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 6, color: "#14532d", fontSize: "0.8rem" }}>
                ✅ Financial year {fy}–{fy + 1} is closed. You may now set up billing for FY {fy + 1}–{fy + 2}.
              </div>
            </div>
          )}
        </div>

        {/* Quick stats column */}
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {[
            { label: "FY Period", val: `Apr ${fy} – Mar ${fy + 1}` },
            { label: "Bills Generated", val: lastGenerated ? (firstGenerated?.label + " → " + lastGenerated?.label) : "None" },
            { label: "Last Confirmed Payment", val: lastFullyPaid?.label || "None yet" },
            { label: "Remaining Pending", val: fmt(summary.totalPending) },
          ].map((s) => (
            <div key={s.label} style={{ background: "white", borderRadius: 8, padding: "0.6rem 0.9rem", border: "1px solid #e2e8f0", minWidth: 140 }}>
              <div style={{ color: "#94a3b8", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</div>
              <div style={{ color: "#1e293b", fontWeight: 700, fontSize: "0.85rem", marginTop: 2 }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthTimeline({ timeline }) {
  if (!timeline?.length) return null;

  const firstGen = timeline.find((m) => m.generated);
  const seedPrincipal = firstGen?.openingPrincipal || 0;
  const seedInterest = firstGen?.openingInterest || 0;
  const seedTotal = seedPrincipal + seedInterest;

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: "2rem" }}>
      <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={S.sectionTitle}>Monthly Billing Journey — All 12 Months</div>
        <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Apr = FY start · Mar = FY closing</div>
      </div>

      {/* Opening Balance Banner */}
      {firstGen && (
        <div style={{ background: "#faf5ff", borderBottom: "1px solid #e9d5ff", padding: "0.75rem 1.25rem", display: "flex", gap: "2rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#7c3aed" }}>
            Opening Balance — as of {firstGen.label} start
          </div>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.82rem", color: "#6d28d9" }}>
              Principal Arrears: <strong>{fmt(seedPrincipal)}</strong>
            </span>
            <span style={{ fontSize: "0.82rem", color: "#6d28d9" }}>
              Interest Arrears: <strong>{fmt(seedInterest)}</strong>
            </span>
            <span style={{ fontSize: "0.82rem", color: "#4c1d95", fontWeight: 800 }}>
              Total Opening: <strong>{fmt(seedTotal)}</strong>
            </span>
          </div>
          {seedTotal === 0 && (
            <span style={{ fontSize: "0.75rem", color: "#a78bfa" }}>All members started with ₹0 balance</span>
          )}
          {firstGen.label && timeline.some((m) => m.isOpeningMonth) && (
            <span style={{ fontSize: "0.72rem", color: "#a78bfa", marginLeft: "auto" }}>
              Society joined mid-FY — billing started from {firstGen.label}
            </span>
          )}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr>
              {["Month", "Status", "Bills", "Opening Balance", "Billed", "Collected", "Pending", "Interest", "Sinking Fund", "Repair Fund", "Collection %"].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeline.map((row, i) => {
              const isEven = i % 2 === 0;
              const bg = row.isOpeningMonth ? "#faf5ff"
                : row.isMarch ? (row.allPaid ? "#f0fdf4" : "#fffbeb")
                : (isEven ? "#fff" : "#f8fafc");
              const dash = <span style={{ color: "#cbd5e1" }}>—</span>;

              let openingCell;
              if (row.isOpeningMonth) {
                openingCell = (
                  <div style={{ fontSize: "0.75rem" }}>
                    <div style={{ color: "#7c3aed", fontWeight: 700 }}>{fmt(seedTotal)}</div>
                    <div style={{ color: "#a78bfa", fontSize: "0.65rem" }}>P: {fmt(seedPrincipal)} · I: {fmt(seedInterest)}</div>
                    <div style={{ color: "#c4b5fd", fontSize: "0.65rem" }}>carried forward →</div>
                  </div>
                );
              } else if (row.generated && row.openingTotal > 0) {
                openingCell = (
                  <div>
                    <div style={{ color: "#6d28d9", fontWeight: 700 }}>{fmt(row.openingTotal)}</div>
                    <div style={{ fontSize: "0.68rem", color: "#a78bfa" }}>P: {fmt(row.openingPrincipal)} · I: {fmt(row.openingInterest)}</div>
                  </div>
                );
              } else if (row.generated) {
                openingCell = <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>₹0</span>;
              } else {
                openingCell = dash;
              }

              return (
                <tr key={row.periodId} style={{ background: bg, borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ ...S.td, fontWeight: (row.isMarch || row.isOpeningMonth) ? 800 : 600, color: row.isOpeningMonth ? "#7c3aed" : row.isMarch ? "#d97706" : "#1e293b", whiteSpace: "nowrap" }}>
                    {row.label}
                    {row.isMarch && <span style={{ marginLeft: 6, fontSize: "0.65rem", color: "#d97706", background: "#fef3c7", padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>FY CLOSE</span>}
                    {row.isOpeningMonth && <span style={{ marginLeft: 6, fontSize: "0.65rem", color: "#7c3aed", background: "#ede9fe", padding: "1px 5px", borderRadius: 4, fontWeight: 700 }}>PRE-START</span>}
                  </td>
                  <td style={S.td}><StatusBadge row={row} /></td>
                  <td style={{ ...S.td, color: "#64748b" }}>{row.generated ? row.billCount : dash}</td>
                  <td style={S.td}>{openingCell}</td>
                  <td style={{ ...S.td, color: "#1d4ed8", fontWeight: 600 }}>{row.generated ? fmt(row.totalBilled) : dash}</td>
                  <td style={{ ...S.td, color: "#16a34a", fontWeight: 600 }}>{row.generated ? fmt(row.totalPaid) : dash}</td>
                  <td style={{ ...S.td, color: row.totalPending > 0 ? "#dc2626" : "#64748b", fontWeight: row.totalPending > 0 ? 700 : 400 }}>
                    {row.generated ? (row.totalPending > 0 ? fmt(row.totalPending) : "₹0") : dash}
                  </td>
                  <td style={{ ...S.td, color: "#7c3aed" }}>{row.generated ? fmt(row.totalInterest) : dash}</td>
                  <td style={{ ...S.td, color: "#0891b2" }}>{row.generated ? fmt(row.totalSinking) : dash}</td>
                  <td style={{ ...S.td, color: "#ea580c" }}>{row.generated ? fmt(row.totalRepair) : dash}</td>
                  <td style={S.td}>
                    {row.generated && row.totalBilled > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 60, height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: pct(row.totalPaid, row.totalBilled), height: "100%", background: row.allPaid ? "#16a34a" : "#3b82f6", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{pct(row.totalPaid, row.totalBilled)}</span>
                      </div>
                    ) : dash}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BalanceSheetPage() {
  const [fy, setFy] = useState(currentFY());
  const [entries, setEntries] = useState([]);
  const [newEntry, setNewEntry] = useState({ name: "", type: "Maintenance", income: "", expenditure: "" });
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["balance-sheet", fy],
    queryFn: () => fetchBalanceSheet(fy),
    staleTime: 2 * 60 * 1000,
  });

  const summary = data?.summary || {};
  const closing = data?.closing || null;
  const timeline = data?.timeline || [];
  const availableFYs = data?.availableFYs || [];

  const fyYears = useMemo(() => {
    const set = new Set([...availableFYs, currentFY()]);
    return [...set].sort((a, b) => b - a).slice(0, 8);
  }, [availableFYs]);

  const customIncome = entries.reduce((s, e) => s + (parseFloat(e.income) || 0), 0);
  const customExpenditure = entries.reduce((s, e) => s + (parseFloat(e.expenditure) || 0), 0);
  const totalIncome = (summary.totalCollected || 0) + customIncome;
  const totalExpenditure = (summary.priorPending || 0) + customExpenditure;
  const netResult = totalIncome - totalExpenditure;

  const liabilityEntries = entries.filter((e) => parseFloat(e.income) > 0);
  const assetEntries = entries.filter((e) => parseFloat(e.expenditure) > 0);

  const handleAddEntry = () => {
    if (!newEntry.name.trim()) return;
    if (!newEntry.income && !newEntry.expenditure) return;
    setEntries([...entries, { ...newEntry, id: Date.now() }]);
    setNewEntry({ name: "", type: "Maintenance", income: "", expenditure: "" });
    setAddOpen(false);
  };
  const removeEntry = (id) => setEntries(entries.filter((e) => e.id !== id));

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.75rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={S.heading}>Balance Sheet</h1>
          <p style={S.sub}>{data?.fyLabel || `Apr ${fy} – Mar ${fy + 1}`} · Full Financial Year Overview</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ color: "#64748b", fontSize: "0.78rem", fontWeight: 600 }}>Financial Year</span>
          <select value={fy} onChange={(e) => setFy(parseInt(e.target.value))} style={S.select}>
            {fyYears.map((y) => <option key={y} value={y}>FY {y}–{y + 1}</option>)}
          </select>
        </div>
      </div>

      {isLoading && <div style={{ padding: "4rem", textAlign: "center", color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "2rem", color: "#ef4444", textAlign: "center" }}>{error.message}</div>}

      {!isLoading && !error && (
        <>
          {/* ── CLOSING STATUS PANEL ── */}
          <div style={S.sectionTitle}>FY Closing Status</div>
          <ClosingPanel closing={closing} summary={summary} fy={fy} />

          {/* ── SUMMARY CARDS — Row 1 ── */}
          <div style={S.sectionTitle}>Financial Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
            <div style={S.card("#3b82f6")}>
              <div style={S.cardLabel}>Total Billed</div>
              <div style={S.cardValue("#1d4ed8")}>{fmt(summary.totalBilled)}</div>
              <div style={S.cardSub}>{summary.billCount || 0} bills raised this FY</div>
            </div>
            <div style={S.card("#10b981")}>
              <div style={S.cardLabel}>Amount Collected</div>
              <div style={S.cardValue("#059669")}>{fmt(summary.totalCollected)}</div>
              <div style={S.cardSub}>{pct(summary.totalCollected, summary.totalBilled)} of total billed</div>
            </div>
            <div style={S.card("#ef4444")}>
              <div style={S.cardLabel}>Current FY Pending</div>
              <div style={S.cardValue("#dc2626")}>{fmt(summary.totalPending)}</div>
              <div style={S.cardSub}>Unpaid dues this FY</div>
            </div>
            <div style={S.card("#f59e0b")}>
              <div style={S.cardLabel}>Prior Year Dues</div>
              <div style={S.cardValue("#d97706")}>{fmt(summary.priorPending)}</div>
              <div style={S.cardSub}>Carried from before Apr {fy}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
            <div style={S.card("#8b5cf6")}>
              <div style={S.cardLabel}>Interest Charged</div>
              <div style={S.cardValue("#7c3aed")}>{fmt(summary.totalInterest)}</div>
              <div style={S.cardSub}>Late payment interest this FY</div>
            </div>
            <div style={S.card("#06b6d4")}>
              <div style={S.cardLabel}>Sinking Fund</div>
              <div style={S.cardValue("#0891b2")}>{fmt(summary.totalSinking)}</div>
              <div style={S.cardSub}>Collected in bills</div>
            </div>
            <div style={S.card("#f97316")}>
              <div style={S.cardLabel}>Repair & Maintenance</div>
              <div style={S.cardValue("#ea580c")}>{fmt(summary.totalRepair)}</div>
              <div style={S.cardSub}>Collected in bills</div>
            </div>
            <div style={S.card(netResult >= 0 ? "#16a34a" : "#dc2626", netResult >= 0 ? "#f0fdf4" : "#fff5f5")}>
              <div style={S.cardLabel}>Net Result</div>
              <div style={S.cardValue(netResult >= 0 ? "#16a34a" : "#dc2626")}>
                {netResult >= 0 ? "+" : ""}{fmt(netResult)}
              </div>
              <div style={S.cardSub}>{netResult >= 0 ? "Surplus" : "Deficit"} this FY</div>
            </div>
          </div>

          {/* ── MONTHLY TIMELINE ── */}
          <div style={S.sectionTitle}>Month-by-Month Journey</div>
          <MonthTimeline timeline={timeline} />

          {/* ── LIABILITY / ASSET ── */}
          <div style={S.sectionTitle}>Liability & Asset Breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={S.panel("#bbf7d0", "#f0fdf4")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={S.panelHead("#16a34a")}>Liabilities (Income / Receipts)</h3>
                <span style={{ color: "#16a34a", fontWeight: 800 }}>{fmt(totalIncome)}</span>
              </div>
              {[
                { name: "Total Bills Raised", val: summary.totalBilled },
                { name: "Amount Collected (Payments)", val: summary.totalCollected },
                { name: "Sinking Fund Collected", val: summary.totalSinking },
                { name: "Repair & Maintenance Collected", val: summary.totalRepair },
              ].map((r) => (
                <div key={r.name} style={S.divRow("#bbf7d0")}>
                  <span style={{ color: "#15803d" }}>{r.name}</span>
                  <span style={{ color: "#14532d", fontWeight: 700 }}>{fmt(r.val)}</span>
                </div>
              ))}
              {liabilityEntries.map((e) => (
                <div key={e.id} style={{ ...S.divRow("#bbf7d0") }}>
                  <span style={{ color: "#15803d" }}>{e.name} <span style={{ color: "#86efac", fontSize: "0.7rem" }}>[{e.type}]</span></span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: "#14532d", fontWeight: 700 }}>{fmt(e.income)}</span>
                    <button onClick={() => removeEntry(e.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={S.panel("#fecaca", "#fff5f5")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 style={S.panelHead("#dc2626")}>Assets (Expenditure / Losses)</h3>
                <span style={{ color: "#dc2626", fontWeight: 800 }}>{fmt(totalExpenditure)}</span>
              </div>
              {[
                { name: "Prior Year Pending Dues", val: summary.priorPending },
                { name: "Interest Accrued", val: summary.totalInterest },
                { name: "Current FY Pending", val: summary.totalPending },
              ].map((r) => (
                <div key={r.name} style={S.divRow("#fecaca")}>
                  <span style={{ color: "#b91c1c" }}>{r.name}</span>
                  <span style={{ color: "#7f1d1d", fontWeight: 700 }}>{fmt(r.val)}</span>
                </div>
              ))}
              {assetEntries.map((e) => (
                <div key={e.id} style={{ ...S.divRow("#fecaca") }}>
                  <span style={{ color: "#b91c1c" }}>{e.name} <span style={{ color: "#fca5a5", fontSize: "0.7rem" }}>[{e.type}]</span></span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ color: "#7f1d1d", fontWeight: 700 }}>{fmt(e.expenditure)}</span>
                    <button onClick={() => removeEntry(e.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── NET RESULT BANNER ── */}
          <div style={{
            background: netResult >= 0 ? "#f0fdf4" : "#fff5f5",
            border: `1px solid ${netResult >= 0 ? "#86efac" : "#fca5a5"}`,
            borderLeft: `4px solid ${netResult >= 0 ? "#16a34a" : "#dc2626"}`,
            borderRadius: 10, padding: "1.25rem 1.5rem",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: "2rem",
          }}>
            <div>
              <div style={{ color: "#64748b", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Net Result — Collected − Outstanding</div>
              <div style={{ color: "#94a3b8", fontSize: "0.72rem", marginTop: 2 }}>
                {netResult >= 0 ? "Surplus — society collected more than outstanding dues" : "Deficit — outstanding dues exceed collections"}
              </div>
            </div>
            <div style={{ color: netResult >= 0 ? "#16a34a" : "#dc2626", fontSize: "2rem", fontWeight: 800 }}>
              {netResult >= 0 ? "+" : ""}{fmt(netResult)}
            </div>
          </div>

          {/* ── CUSTOM ENTRIES TABLE ── */}
          {entries.length > 0 && (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: "1.5rem", overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <div style={S.sectionTitle}>Custom Entries ({entries.length})</div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Name", "Type", "Income", "Expenditure", "Side", ""].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const isLiab = parseFloat(e.income) > 0;
                    return (
                      <tr key={e.id} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                        <td style={{ ...S.td, fontWeight: 600, color: "#1e293b" }}>{e.name}</td>
                        <td style={{ ...S.td, color: "#64748b" }}>{e.type}</td>
                        <td style={{ ...S.td, color: "#16a34a", fontWeight: 600 }}>{e.income ? fmt(e.income) : "—"}</td>
                        <td style={{ ...S.td, color: "#dc2626", fontWeight: 600 }}>{e.expenditure ? fmt(e.expenditure) : "—"}</td>
                        <td style={S.td}>
                          <span style={S.badge(isLiab ? "#16a34a" : "#dc2626", isLiab ? "#dcfce7" : "#fee2e2")}>
                            {isLiab ? "Liability" : "Asset"}
                          </span>
                        </td>
                        <td style={S.td}>
                          <button onClick={() => removeEntry(e.id)} style={{ background: "none", border: "1px solid #e2e8f0", color: "#94a3b8", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "0.75rem" }}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── ADD ENTRY ── */}
          <button
            onClick={() => setAddOpen(!addOpen)}
            style={{ padding: "0.5rem 1.25rem", borderRadius: 6, border: `1px solid ${addOpen ? "#ef4444" : "#3b82f6"}`, background: "transparent", color: addOpen ? "#ef4444" : "#3b82f6", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", marginBottom: "1rem" }}
          >
            {addOpen ? "✕ Cancel" : "+ Add Custom Entry"}
          </button>

          {addOpen && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.5rem" }}>
              <div style={{ ...S.sectionTitle, marginBottom: "1rem" }}>New Custom Entry</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "1rem", alignItems: "flex-end" }}>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Name *</label>
                  <input value={newEntry.name} onChange={(e) => setNewEntry({ ...newEntry, name: e.target.value })} placeholder="e.g. Water Tank Repair" style={S.input} />
                </div>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Type</label>
                  <select value={newEntry.type} onChange={(e) => setNewEntry({ ...newEntry, type: e.target.value })} style={{ ...S.input, cursor: "pointer" }}>
                    {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Income (₹)</label>
                  <input type="number" value={newEntry.income} onChange={(e) => setNewEntry({ ...newEntry, income: e.target.value, expenditure: "" })} placeholder="0" min="0" style={S.input} />
                </div>
                <div>
                  <label style={{ ...S.cardLabel, display: "block", marginBottom: 4 }}>Expenditure (₹)</label>
                  <input type="number" value={newEntry.expenditure} onChange={(e) => setNewEntry({ ...newEntry, expenditure: e.target.value, income: "" })} placeholder="0" min="0" style={S.input} />
                </div>
              </div>
              <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
                <button
                  onClick={handleAddEntry}
                  disabled={!newEntry.name.trim() || (!newEntry.income && !newEntry.expenditure)}
                  style={{
                    padding: "0.55rem 1.5rem", borderRadius: 6, border: "none",
                    background: (newEntry.name.trim() && (newEntry.income || newEntry.expenditure)) ? "#16a34a" : "#cbd5e1",
                    color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.88rem",
                  }}
                >
                  Add Entry
                </button>
                <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Income OR Expenditure — not both. Name required.</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
