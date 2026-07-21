"use client";
export default function ExcelPreviewGrid({ columns, rows, title, onReupload, onContinue, onCancel, summary }) {
  const validRows = rows.filter((r) => r.status !== "error");
  const errorRows = rows.filter((r) => r.status === "error");
  const warningRows = rows.filter((r) => r.status === "warning");
  const rowBg = (status) => ({ valid: "transparent", warning: "#fffbeb", error: "#fef2f2", skipped: "#f8fafc" }[status] || "transparent");
  const cellStyle = (cellStatus) => {
    const base = {
      padding: "6px 10px",
      border: "1px solid #e5e7eb",
      fontSize: "0.78rem",
      whiteSpace: "nowrap",
      maxWidth: "180px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      verticalAlign: "top",
    };
    if (cellStatus === "error") return { ...base, background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", fontWeight: 600 };
    if (cellStatus === "warning") return { ...base, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" };
    return base;
  };
  return (
    <div style={{ background: "#fff", border: "2px solid #e5e7eb", borderRadius: "12px", overflow: "hidden", marginBottom: "1.5rem" }}>
      {/* Header */}
      <div style={{ background: "#f9fafb", padding: "1rem 1.5rem", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", color: "#1f2937" }}>{title || "Upload Preview"}</h3>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          {[
            ["Valid", validRows.length, "#059669", "#d1fae5"],
            ["Warnings", warningRows.length, "#d97706", "#fef3c7"],
            ["Errors", errorRows.length, "#dc2626", "#fee2e2"],
          ].map(([label, count, color, bg]) => (
            <div key={label} style={{ background: bg, border: `1px solid ${color}`, borderRadius: "6px", padding: "4px 12px", textAlign: "center", minWidth: "70px" }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color }}>{count}</div>
              <div style={{ fontSize: "0.7rem", color }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Grid */}
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "440px" }}>
        <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "#f3f4f6" }}>
            <tr>
              <th style={{ padding: "8px 10px", border: "1px solid #d1d5db", background: "#e5e7eb", fontSize: "0.75rem", color: "#374151", fontWeight: 700, minWidth: "50px" }}>#</th>
              <th style={{ padding: "8px 10px", border: "1px solid #d1d5db", background: "#e5e7eb", fontSize: "0.75rem", color: "#374151", fontWeight: 700, minWidth: "80px" }}>Status</th>
              {columns.map((col) => (
                <th key={col} style={{ padding: "8px 10px", border: "1px solid #d1d5db", fontSize: "0.75rem", color: "#374151", fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNum} style={{ background: rowBg(row.status) }}>
                <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb", fontSize: "0.75rem", color: "#9ca3af", textAlign: "center" }}>{row.rowNum}</td>
                <td style={{ padding: "6px 10px", border: "1px solid #e5e7eb", textAlign: "center" }}>
                  {row.status === "valid" && <span style={{ background: "#d1fae5", color: "#065f46", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>✓ Valid</span>}
                  {row.status === "warning" && <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>⚠ Warn</span>}
                  {row.status === "error" && <span style={{ background: "#fee2e2", color: "#991b1b", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>✗ Error</span>}
                  {row.status === "skipped" && <span style={{ background: "#f1f5f9", color: "#64748b", padding: "2px 8px", borderRadius: "10px", fontSize: "0.7rem", fontWeight: 700 }}>— No Payment</span>}
                </td>
                {columns.map((col) => {
                  const cell = row.cells[col] || { value: "" };
                  return (
                    <td key={col} style={cellStyle(cell.status)} title={cell.message || ""}>
                      {cell.value === undefined || cell.value === null ? "" : String(cell.value)}
                      {cell.message && (
                        <div style={{ fontSize: "0.65rem", color: cell.status === "error" ? "#dc2626" : "#d97706", marginTop: "2px", whiteSpace: "normal" }}>
                          {cell.message}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Footer Actions */}
      <div style={{ padding: "1rem 1.5rem", borderTop: "2px solid #e5e7eb", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-secondary" onClick={onReupload}>↩ Re-upload</button>
        <button
          className="btn btn-success"
          disabled={validRows.length === 0}
          onClick={() => onContinue(validRows)}
          style={{ opacity: validRows.length === 0 ? 0.5 : 1 }}
        >
          {errorRows.length > 0
            ? `▶ Continue with ${validRows.length} Valid Row${validRows.length !== 1 ? "s" : ""} (skip ${errorRows.length} error${errorRows.length !== 1 ? "s" : ""})`
            : `▶ Continue — All ${validRows.length} Rows Valid`}
        </button>
        <button className="btn btn-danger" style={{ marginLeft: "auto" }} onClick={onCancel}>✕ Cancel Upload</button>
      </div>
    </div>
  );
}
