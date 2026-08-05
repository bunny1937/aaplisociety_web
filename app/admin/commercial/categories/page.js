"use client";
import { useCallback, useEffect, useState } from "react";

// Global categories are platform-managed and read-only here; a society can add
// and manage its own on top of them. Global rows are never copied per society.
export default function AdminCommercialCategoriesPage() {
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const notify = (message, tone) => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/commercial/categories", { credentials: "include" });
      if (res.status === 403) {
        setEnabled(false);
        return;
      }
      setEnabled(true);
      setRows((await res.json()).categories ?? []);
    } catch {
      notify("Could not load categories", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/commercial/categories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed");
      setName("");
      notify("Category added");
      load();
    } catch (e2) {
      notify(typeof e2.message === "string" ? e2.message : "Could not add", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row) {
    setBusy(true);
    try {
      const res = await fetch(`/api/commercial/categories/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Failed");
      load();
    } catch (e) {
      notify(String(e.message ?? e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <div style={S.wrap}>
        <h1 style={S.h1}>Categories</h1>
        <div style={S.notice}>The commercial module is switched off for this society.</div>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div>
        <h1 style={S.h1}>Categories</h1>
        <p style={S.sub}>Shared defaults plus categories you add for this society.</p>
      </div>

      <form onSubmit={add} style={{ ...S.card, flexDirection: "row", alignItems: "flex-end" }}>
        <label style={{ ...S.label, flex: 1 }}>
          New category
          <input style={S.input} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tiffin Service" />
        </label>
        <button style={S.primary} type="submit" disabled={busy}>Add</button>
      </form>

      {loading ? (
        <p style={S.sub}>Loading...</p>
      ) : (
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Name</th>
                <th style={S.th}>Source</th>
                <th style={S.th}>Order</th>
                <th style={S.th}>Status</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={S.td}>{c.name}</td>
                  <td style={S.td}>{c.scope === "GLOBAL" ? "Shared default" : "This society"}</td>
                  <td style={S.td}>{c.sortOrder}</td>
                  <td style={S.td}>
                    <span style={{ ...S.badge, background: c.isActive ? "#dcfce7" : "#f3f4f6", color: c.isActive ? "#166534" : "#374151" }}>
                      {c.isActive ? "Active" : "Hidden"}
                    </span>
                  </td>
                  <td style={S.td}>
                    {c.scope === "SOCIETY" && (
                      <button style={S.ghost} disabled={busy} onClick={() => toggle(c)}>
                        {c.isActive ? "Hide" : "Show"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div style={{ ...S.toast, background: toast.tone === "error" ? "#991b1b" : "#111827" }}>{toast.message}</div>
      )}
    </div>
  );
}

const S = {
  wrap: { padding: 24, display: "flex", flexDirection: "column", gap: 16 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  h1: { fontSize: 22, fontWeight: 700, margin: 0 },
  sub: { color: "#6b7280", margin: "4px 0 0", fontSize: 13 },
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "#374151" },
  input: { padding: "9px 11px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14, fontWeight: 400 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e5e7eb", color: "#6b7280", fontSize: 12 },
  td: { padding: "10px", borderBottom: "1px solid #f3f4f6" },
  badge: { padding: "3px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  primary: { background: "#111827", color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontWeight: 600, cursor: "pointer" },
  ghost: { background: "#fff", border: "1px solid #d1d5db", borderRadius: 8, padding: "6px 10px", cursor: "pointer", marginRight: 6 },
  notice: { background: "#f9fafb", border: "1px dashed #d1d5db", borderRadius: 12, padding: 16, color: "#4b5563", fontSize: 14 },
  toast: { position: "fixed", bottom: 24, right: 24, color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 14 },
};
