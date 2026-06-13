"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";

const H = {};

async function adminGet(url) {
  const res = await fetch(url, { credentials: "include", headers: H });
  if (!res.ok) throw new Error((await res.json()).error || "Failed");
  return res.json();
}

const COLLECTIONS = ["bills", "members", "transactions", "billingheads", "receipts"];

const COL_LABELS = {
  bills: ["Period", "Member", "Wing", "Flat", "Current Charges", "Previous Balance", "Total Due", "Balance", "Status", "Due Date", "Created"],
  members: ["Owner Name", "Wing", "Flat", "Email", "Phone", "Carpet Area", "Ownership", "Opening Balance", "Created"],
  transactions: ["Member", "Wing", "Flat", "Type", "Amount", "Payment Method", "Date", "Reference", "Created"],
  billingheads: ["Head Name", "Calculation Type", "Default Amount", "Active", "Created"],
  receipts: ["Member", "Wing", "Flat", "Period", "Amount Paid", "Payment Method", "Date", "Receipt No"],
};

function rowForCollection(item, col) {
  if (col === "bills") return [
    item.billPeriodId, item.memberId?.ownerName || "", item.memberId?.wing || item.wing || "", item.memberId?.flatNo || item.flatNo || "",
    item.currentCharges, item.previousBalance, item.totalBillDue, item.balanceAmount, item.status,
    item.dueDate ? new Date(item.dueDate).toLocaleDateString("en-IN") : "",
    item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : "",
  ];
  if (col === "members") return [
    item.ownerName, item.wing, item.flatNo, item.emailPrimary, item.phonePrimary,
    item.carpetAreaSqft, item.ownershipType, item.openingBalance,
    item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : "",
  ];
  if (col === "transactions") return [
    item.memberId?.ownerName || "", item.memberId?.wing || item.wing || "", item.memberId?.flatNo || item.flatNo || "",
    item.type, item.amount, item.paymentMethod,
    item.date ? new Date(item.date).toLocaleDateString("en-IN") : "",
    item.referenceNumber || item.transactionId || "",
    item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : "",
  ];
  if (col === "billingheads") return [
    item.headName, item.calculationType, item.defaultAmount,
    item.isActive ? "Yes" : "No",
    item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : "",
  ];
  if (col === "receipts") return [
    item.memberId?.ownerName || "", item.memberId?.wing || item.wing || "", item.memberId?.flatNo || item.flatNo || "",
    item.billPeriodId, item.amountPaid, item.paymentMethod,
    item.paymentDate ? new Date(item.paymentDate).toLocaleDateString("en-IN") : "",
    item.receiptNumber || "",
  ];
  return [];
}

export default function SuperAdminExportsPage() {
  const [selectedSociety, setSelectedSociety] = useState("all");
  const [selectedCollection, setSelectedCollection] = useState("bills");
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: societiesData } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: () => adminGet("/api/admin/societies"),
  });
  const societies = societiesData?.societies || [];

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const targets = selectedSociety === "all" ? societies.map((s) => s._id) : [selectedSociety];
      let allRows = [];
      for (const sid of targets) {
        const res = await adminGet(`/api/admin/data-browser?societyId=${sid}&collection=${selectedCollection}`);
        const soc = societies.find((s) => s._id === sid);
        allRows = allRows.concat((res.data || []).map((r) => ({ ...r, _societyName: soc?.name || sid })));
      }
      setPreview(allRows);
    } catch (e) {
      alert("Preview failed: " + e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExport = async (format) => {
    setExporting(true);
    try {
      const rows = preview;
      if (!rows?.length) { alert("Load preview first"); return; }

      const headers = ["Society", ...COL_LABELS[selectedCollection]];
      const dataRows = rows.map((r) => [r._societyName, ...rowForCollection(r, selectedCollection)]);

      if (format === "csv") {
        const csv = [headers, ...dataRows].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = `export_${selectedCollection}_${Date.now()}.csv`; a.click();
      } else {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
        ws["!cols"] = headers.map(() => ({ wch: 18 }));
        XLSX.utils.book_append_sheet(wb, ws, selectedCollection);
        XLSX.writeFile(wb, `export_${selectedCollection}_${Date.now()}.xlsx`);
      }
    } finally {
      setExporting(false);
    }
  };

  const card = (label, value, color) => (
    <div style={{ background: "#ffffff", border: `1px solid #e5e7eb`, borderRadius: 12, padding: "18px 20px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
      <div style={{ color: "#6b7280", fontSize: "13px", fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div style={{ color, fontSize: "26px", fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: 0, maxWidth: 1300, margin: "0 auto", color: "#1f2937" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: "0.25rem", color: "#1f2937" }}>📦 Data Exports</h1>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1.75rem" }}>
        Export any collection for any society as Excel or CSV.
      </p>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.75rem" }}>
        {card("Total Societies", societies.length, "#60a5fa")}
        {card("Active", societies.filter((s) => s.subscription?.status === "Active").length, "#34d399")}
        {card("Trial", societies.filter((s) => s.subscription?.status === "Trial").length, "#a78bfa")}
        {card("Preview Rows", preview?.length ?? "—", "#fbbf24")}
      </div>

      {/* Controls */}
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px", marginBottom: "1.5rem", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto auto", gap: "1rem", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", color: "#6b7280", fontSize: "12px", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>SOCIETY</label>
            <select
              value={selectedSociety}
              onChange={(e) => { setSelectedSociety(e.target.value); setPreview(null); }}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: 6, border: "1px solid #d1d5db", background: "#ffffff", color: "#1f2937", fontSize: "0.9rem" }}
            >
              <option value="all">All Societies ({societies.length})</option>
              {societies.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", color: "#6b7280", fontSize: "12px", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>COLLECTION</label>
            <select
              value={selectedCollection}
              onChange={(e) => { setSelectedCollection(e.target.value); setPreview(null); }}
              style={{ width: "100%", padding: "0.6rem 0.75rem", borderRadius: 6, border: "1px solid #d1d5db", background: "#ffffff", color: "#1f2937", fontSize: "0.9rem" }}
            >
              {COLLECTIONS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <button
            onClick={loadPreview}
            disabled={previewLoading}
            style={{ padding: "0.6rem 1.25rem", borderRadius: 6, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontSize: "0.9rem" }}
          >
            {previewLoading ? "Loading..." : "👁 Preview"}
          </button>
          <button
            onClick={() => handleExport("xlsx")}
            disabled={!preview?.length || exporting}
            style={{ padding: "0.6rem 1.25rem", borderRadius: 6, border: "none", background: preview?.length ? "#059669" : "#374151", color: "#fff", fontWeight: 700, cursor: preview?.length ? "pointer" : "not-allowed", whiteSpace: "nowrap", fontSize: "0.9rem" }}
          >
            ⬇ Excel
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={!preview?.length || exporting}
            style={{ padding: "0.6rem 1.25rem", borderRadius: 6, border: "none", background: preview?.length ? "#7c3aed" : "#374151", color: "#fff", fontWeight: 700, cursor: preview?.length ? "pointer" : "not-allowed", whiteSpace: "nowrap", fontSize: "0.9rem" }}
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* Preview table */}
      {previewLoading && (
        <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>Fetching data...</div>
      )}
      {preview !== null && !previewLoading && (
        preview.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>No records found for this selection.</div>
        ) : (
          <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb" }}>
              <span style={{ color: "#6b7280", fontSize: "13px" }}>
                Showing <strong style={{ color: "#1f2937" }}>{Math.min(preview.length, 200)}</strong> of <strong style={{ color: "#1f2937" }}>{preview.length}</strong> rows
              </span>
              <span style={{ color: "#9ca3af", fontSize: "12px" }}>Download buttons above export ALL rows</span>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead style={{ position: "sticky", top: 0, background: "#f9fafb", zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: "10px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600, borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Society</th>
                    {COL_LABELS[selectedCollection].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600, borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 200).map((item, i) => (
                    <tr key={item._id || i} style={{ background: "#ffffff", borderBottom: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "10px 12px", color: "#1e3a8a", fontWeight: 600, whiteSpace: "nowrap" }}>{item._societyName}</td>
                      {rowForCollection(item, selectedCollection).map((v, ci) => (
                        <td key={ci} style={{ padding: "10px 12px", color: "#374151", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {v === undefined || v === null ? "—" : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {preview === null && !previewLoading && (
        <div style={{ padding: "4rem", textAlign: "center", color: "#374151", border: "2px dashed #1f2937", borderRadius: 10, fontSize: "0.9rem" }}>
          Select a society + collection, then click <strong style={{ color: "#3b82f6" }}>Preview</strong> to see data before exporting.
        </div>
      )}
    </div>
  );
}
