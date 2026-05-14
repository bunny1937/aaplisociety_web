"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/ViewBills.module.css";

const STATUS_COLOR = {
  Paid: { bg: "#dcfce7", text: "#15803d", border: "#86efac" },
  Partial: { bg: "#fef9c3", text: "#92400e", border: "#fcd34d" },
  Unpaid: { bg: "#fee2e2", text: "#b91c1c", border: "#fca5a5" },
  Overdue: { bg: "#f3e8ff", text: "#7c3aed", border: "#c4b5fd" },
  Scheduled: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" },
};

function fmt(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ViewBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewingBill, setViewingBill] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [downloadingId, setDownloadingId] = useState(null);

  const { data: billsData, isLoading } = useQuery({
    queryKey: ["view-bills", selectedPeriod, filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriod !== "all") params.append("period", selectedPeriod);
      if (filterStatus !== "all") params.append("status", filterStatus);
      const qs = params.toString();
      return apiClient.get(`/api/billing/generated${qs ? "?" + qs : ""}`);
    },
  });

  const { data: receiptsData, isLoading: receiptsLoading } = useQuery({
    queryKey: ["bill-receipts", viewingBill?.memberId?._id],
    queryFn: () => apiClient.get(`/api/receipts?memberId=${viewingBill.memberId._id}`),
    enabled: !!viewingBill?.memberId?._id && activeTab === "receipts",
  });

  const bills = billsData?.bills || [];
  const periods = [...new Set(bills.map((b) => b.billPeriodId))].filter(Boolean).sort().reverse();

  const filteredBills = bills.filter((b) => {
    const q = searchTerm.toLowerCase();
    return (
      b.memberId?.flatNo?.toLowerCase().includes(q) ||
      b.memberId?.ownerName?.toLowerCase().includes(q) ||
      b.memberId?.wing?.toLowerCase().includes(q)
    );
  });

  const openBill = (bill) => { setViewingBill(bill); setActiveTab("summary"); };

  const downloadBill = async (bill) => {
    setDownloadingId(bill._id?.toString());
    try {
      let html = bill.billHtml;
      if (!html) {
        const res = await fetch(`/api/bills/download?id=${bill._id}`, { credentials: "include" });
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) {
          html = await res.text();
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement("a"), { href: url, download: `Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf` });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }
      }
      if (!html) { alert("No bill data. Please regenerate."); return; }
      const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{font-family:Arial,sans-serif;padding:20px;}@media print{body{padding:0;}@page{margin:8mm;size:A4;}}</style></head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) alert("Popup blocked. Please allow popups for this site.");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      alert("Download failed: " + e.message);
    } finally {
      setDownloadingId(null);
    }
  };

  const exportToExcel = async () => {
    try {
      const res = await fetch("/api/billing/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ period: selectedPeriod !== "all" ? selectedPeriod : null }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `Bills-${selectedPeriod}.xlsx` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { alert("Export failed"); }
  };

  const sc = viewingBill ? (STATUS_COLOR[viewingBill.status] || STATUS_COLOR.Scheduled) : null;

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1>View Bills</h1>
          <p>{filteredBills.length} bill{filteredBills.length !== 1 ? "s" : ""}{selectedPeriod !== "all" ? ` · ${selectedPeriod}` : " · all periods"}</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={exportToExcel} className="btn btn-secondary">Export Excel</button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filtersCard}>
        <div className={styles.filterRow}>
          <div className={styles.searchBox}>
            <input type="text" placeholder="Search flat, name, wing..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className={styles.searchInput} />
          </div>
          <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)} className={styles.select}>
            <option value="all">All Periods</option>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={styles.select}>
            <option value="all">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Overdue">Overdue</option>
          </select>
          <div className={styles.resultCount}>{filteredBills.length} Bills</div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className={styles.loading}><div className={styles.spinner} /><p>Loading bills...</p></div>
      ) : filteredBills.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          <h3>No bills found</h3>
          <p>Adjust filters or generate bills first</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.billsTable}>
            <thead>
              <tr>
                <th>Flat</th>
                <th>Member</th>
                <th>Period</th>
                <th>Current Bill</th>
                <th>Prev Balance</th>
                <th>Interest</th>
                <th>Total Due</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Due Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((bill) => {
                const colors = STATUS_COLOR[bill.status] || STATUS_COLOR.Scheduled;
                return (
                  <tr key={bill._id} className={styles.billRow} onClick={() => openBill(bill)}>
                    <td><strong>{bill.memberId?.wing}-{bill.memberId?.flatNo}</strong></td>
                    <td>{bill.memberId?.ownerName}</td>
                    <td><span className={styles.periodTag}>{bill.billPeriodId}</span></td>
                    <td>₹{fmt(bill.currentBillTotal ?? bill.subtotal)}</td>
                    <td style={{ color: (bill.previousBalance || 0) > 0 ? "#b91c1c" : "#15803d" }}>
                      {(bill.previousBalance || 0) > 0 ? `₹${fmt(bill.previousBalance)}` : "Clear"}
                    </td>
                    <td style={{ color: (bill.interestAmount || 0) > 0 ? "#92400e" : "#9ca3af" }}>
                      {(bill.interestAmount || 0) > 0 ? `₹${fmt(bill.interestAmount)}` : "—"}
                    </td>
                    <td><strong>₹{fmt(bill.totalAmount)}</strong></td>
                    <td style={{ color: "#15803d" }}>
                      {(bill.amountPaid || 0) > 0 ? `₹${fmt(bill.amountPaid)}` : "—"}
                    </td>
                    <td style={{ color: (bill.balanceAmount || 0) > 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                      {(bill.balanceAmount || 0) > 0.005 ? `₹${fmt(bill.balanceAmount)}` : "Paid"}
                    </td>
                    <td>{fmtDate(bill.dueDate)}</td>
                    <td>
                      <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
                        {bill.status}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openBill(bill)} className={styles.actionBtn}>View</button>
                        <button onClick={() => downloadBill(bill)} className={styles.actionBtn} disabled={downloadingId === bill._id?.toString()}>
                          {downloadingId === bill._id?.toString() ? "..." : "Print"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {viewingBill && (
        <div className={styles.modal} onClick={() => setViewingBill(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>

            {/* Modal Header */}
            <div className={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ background: "#4f46e5", color: "white", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>
                  {viewingBill.memberId?.wing}-{viewingBill.memberId?.flatNo}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "#111" }}>{viewingBill.memberId?.ownerName}</div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>Period: {viewingBill.billPeriodId} · Generated: {fmtDate(viewingBill.generatedAt || viewingBill.createdAt)}</div>
                </div>
              </div>
              <button onClick={() => setViewingBill(null)} className={styles.closeBtn}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "2px solid #e5e7eb", padding: "0 2rem" }}>
              {[["summary", "Summary"], ["bill", "Bill PDF"], ["receipts", "Receipts"]].map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "12px 20px", border: "none", background: "none", cursor: "pointer", fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "#4f46e5" : "#6b7280", borderBottom: activeTab === tab ? "3px solid #4f46e5" : "3px solid transparent", marginBottom: -2, fontSize: 14 }}>
                  {label}
                </button>
              ))}
            </div>

            <div className={styles.modalBody}>

              {/* SUMMARY TAB */}
              {activeTab === "summary" && (
                <div>
                  {/* Status + due date */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 10, padding: "12px 18px", marginBottom: 20 }}>
                    <span style={{ fontWeight: 700, color: sc.text, fontSize: 15 }}>{viewingBill.status}</span>
                    <span style={{ color: "#6b7280", fontSize: 13 }}>Due: {fmtDate(viewingBill.dueDate)}</span>
                  </div>

                  {/* Amount cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
                    {[
                      { label: "Current Bill", value: `₹${fmt(viewingBill.currentBillTotal ?? viewingBill.subtotal)}`, color: "#1f2937" },
                      { label: "Prev Balance", value: (viewingBill.previousBalance || 0) > 0 ? `₹${fmt(viewingBill.previousBalance)}` : "Clear", color: (viewingBill.previousBalance || 0) > 0 ? "#b91c1c" : "#15803d" },
                      { label: "Interest", value: (viewingBill.interestAmount || 0) > 0 ? `₹${fmt(viewingBill.interestAmount)}` : "—", color: (viewingBill.interestAmount || 0) > 0 ? "#92400e" : "#9ca3af" },
                      { label: "Total Due", value: `₹${fmt(viewingBill.totalAmount)}`, color: "#4f46e5", large: true },
                      ...(viewingBill.amountPaid > 0 ? [{ label: "Paid", value: `₹${fmt(viewingBill.amountPaid)}`, color: "#15803d" }] : []),
                      ...((viewingBill.balanceAmount || 0) > 0.005 ? [{ label: "Balance Due", value: `₹${fmt(viewingBill.balanceAmount)}`, color: "#b91c1c", large: true }] : []),
                    ].map((c) => (
                      <div key={c.label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{c.label}</div>
                        <div style={{ fontSize: c.large ? 20 : 15, fontWeight: 700, color: c.color }}>{c.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Charges table */}
                  <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 600, fontSize: 14 }}>Charge Breakdown</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {viewingBill.charges && Object.entries(viewingBill.charges).map(([name, amt], i) => (
                          <tr key={name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                            <td style={{ padding: "10px 16px", color: "#6b7280", width: 32 }}>{i + 1}</td>
                            <td style={{ padding: "10px 16px" }}>{name}</td>
                            <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>₹{fmt(amt)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: "#f0fdf4" }}>
                          <td colSpan={2} style={{ padding: "12px 16px", fontWeight: 700 }}>Current Month Total</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>₹{fmt(viewingBill.currentBillTotal ?? viewingBill.subtotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* BILL PDF TAB */}
              {activeTab === "bill" && (
                <div style={{ maxWidth: 800, margin: "0 auto" }}>
                  {viewingBill.billHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: viewingBill.billHtml }} />
                  ) : (
                    <div className={styles.emptyState} style={{ padding: 60 }}>
                      <div className={styles.emptyIcon}>📄</div>
                      <h3>No bill PDF stored</h3>
                      <p>Click Print / Download to regenerate</p>
                    </div>
                  )}
                </div>
              )}

              {/* RECEIPTS TAB */}
              {activeTab === "receipts" && (
                <div>
                  {receiptsLoading ? (
                    <div className={styles.loading}><div className={styles.spinner} /><p>Loading receipts...</p></div>
                  ) : receiptsData?.receipts?.length > 0 ? (
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "12px 16px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb", fontWeight: 600, fontSize: 14 }}>
                        {receiptsData.receipts.length} Payment{receiptsData.receipts.length !== 1 ? "s" : ""} — {viewingBill.memberId?.ownerName}
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f9fafb" }}>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Receipt No</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Period</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Date</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Amount</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Mode</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptsData.receipts.map((r) => (
                            <tr key={r._id} style={{ borderTop: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13, color: "#4f46e5" }}>{r.receiptNo}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{r.billPeriodId || "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{fmtDate(r.paidAt || r.createdAt)}</td>
                              <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>₹{fmt(r.amount)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{r.paymentMode}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13, color: "#6b7280" }}>{r.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.emptyState} style={{ padding: 60 }}>
                      <div className={styles.emptyIcon}>🧾</div>
                      <h3>No payments recorded</h3>
                      <p>No receipts for this bill yet</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={styles.modalFooter}>
              <button onClick={() => setViewingBill(null)} className="btn btn-secondary">Close</button>
              <button onClick={() => downloadBill(viewingBill)} className="btn btn-primary" disabled={downloadingId === viewingBill._id?.toString()}>
                {downloadingId === viewingBill._id?.toString() ? "Opening..." : "Print / Download Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
