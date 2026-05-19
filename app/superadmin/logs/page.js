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
    <div style={{ padding: 0, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: "0.25rem", color: "#1f2937" }}>
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
          style={{ padding: "0.5rem 0.75rem", borderRadius: 6, border: "1px solid #d1d5db", background: "#ffffff", color: "#1f2937", flex: 1, minWidth: 200 }}
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid #d1d5db", background: "#ffffff", color: "#1f2937" }}
        >
          <option value="all">All Actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="login">Login</option>
          <option value="export">Export</option>
        </select>
        <span style={{ padding: "0.5rem 1rem", background: "#dbeafe", borderRadius: 20, fontWeight: 600, color: "#1e3a8a", fontSize: "0.85rem", display: "flex", alignItems: "center" }}>
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
        <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Timestamp", "Action", "Admin", "Society", "Details"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#6b7280", fontWeight: 600, borderBottom: "1px solid #e5e7eb", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log._id || i} style={{ borderBottom: "1px solid #f3f4f6", background: "#ffffff" }}>
                  <td style={{ padding: "10px 14px", color: "#6b7280", whiteSpace: "nowrap" }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleString("en-IN") : "—"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 10, fontSize: "11px", fontWeight: 700,
                      background: (ACTION_COLOR[log.action?.toLowerCase()] || "#6b7280") + "22",
                      color: ACTION_COLOR[log.action?.toLowerCase()] || "#6b7280",
                    }}>
                      {log.action || "—"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#1f2937" }}>{log.adminEmail || log.adminId || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#6b7280" }}>{log.societyName || log.societyId || "—"}</td>
                  <td style={{ padding: "10px 14px", color: "#9ca3af", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
