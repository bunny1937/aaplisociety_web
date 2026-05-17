"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const ACTION_COLOR = {
  create: "#34d399",
  update: "#60a5fa",
  delete: "#f87171",
  login: "#a78bfa",
  logout: "#94a3b8",
  export: "#fbbf24",
};

async function fetchLogs(filter) {
  const res = await fetch(`/api/admin/logs?filter=${filter}`, {
    credentials: "include",
    headers: { "x-admin-api-key": process.env.NEXT_PUBLIC_ADMIN_API_KEY || "" },
  });
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

export default function SuperAdminLogsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["superadmin-logs", filter],
    queryFn: () => fetchLogs(filter),
    staleTime: 30 * 1000,
  });

  const logs = (data?.logs || []).filter((l) =>
    search
      ? JSON.stringify(l).toLowerCase().includes(search.toLowerCase())
      : true
  );

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        📜 Admin Logs
      </h1>
      <p style={{ color: "#6b7280", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Last 100 admin actions across all societies.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <input
          placeholder="Search logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "#f0f0f0", flex: 1, minWidth: 200 }}
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #374151", background: "#1f2937", color: "#f0f0f0" }}
        >
          <option value="all">All Actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="login">Login</option>
          <option value="export">Export</option>
        </select>
        <span style={{ padding: "0.5rem 1rem", background: "#1e3a5f", borderRadius: 20, fontWeight: 600, color: "#60a5fa", fontSize: "0.85rem", display: "flex", alignItems: "center" }}>
          {logs.length} logs
        </span>
      </div>

      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>Loading logs...</div>
      ) : error ? (
        <div style={{ padding: "2rem", color: "#f87171" }}>Error: {error.message}</div>
      ) : logs.length === 0 ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>No logs found.</div>
      ) : (
        <div style={{ background: "#111827", borderRadius: 10, border: "1px solid #1f2937", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                {["Timestamp", "Action", "Admin", "Society", "Details"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log._id || i} style={{ borderBottom: "1px solid #1f2937", background: i % 2 === 0 ? "#111827" : "#0f172a" }}>
                  <td style={{ padding: "9px 14px", color: "#6b7280", whiteSpace: "nowrap" }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleString("en-IN") : "—"}
                  </td>
                  <td style={{ padding: "9px 14px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700,
                      background: (ACTION_COLOR[log.action?.toLowerCase()] || "#475569") + "22",
                      color: ACTION_COLOR[log.action?.toLowerCase()] || "#94a3b8",
                    }}>
                      {log.action || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "9px 14px", color: "#e2e8f0" }}>{log.adminEmail || log.adminId || "—"}</td>
                  <td style={{ padding: "9px 14px", color: "#94a3b8" }}>{log.societyName || log.societyId || "—"}</td>
                  <td style={{ padding: "9px 14px", color: "#64748b", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {typeof log.details === "object" && log.details !== null
                      ? Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(" · ")
                      : log.details || log.description || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
