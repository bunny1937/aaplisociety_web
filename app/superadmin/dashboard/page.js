"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/lib/admin-api";

export default function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        const user = data.user || data;
        if (user.role !== "SuperAdmin") router.push("/superadmin/login");
        else setAdmin(user);
      })
      .catch(() => router.push("/superadmin/login"));
  }, [router]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: adminApi.fetchSocieties,
    staleTime: 5 * 60 * 1000,
    enabled: !!admin,
  });

  const societies = data?.societies || [];

  const stats = {
    totalSocieties: societies.length,
    totalMembers: societies.reduce((sum, s) => sum + (s.stats?.members || 0), 0),
    totalBills: societies.reduce((sum, s) => sum + (s.stats?.bills || 0), 0),
    activeSocieties: societies.filter((s) => s.subscription?.status === "Active").length,
  };

  const filteredSocieties = societies.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.contactEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.registrationNo?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || s.subscription?.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (!admin) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280", background: "#0f172a", minHeight: "100vh" }}>
        Loading...
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280", background: "#0f172a", minHeight: "100vh" }}>
        Loading societies...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "#ef4444", background: "#0f172a", minHeight: "100vh" }}>
        Error loading data: {error.message}
      </div>
    );
  }

  const statusBadgeStyle = (status) => {
    const map = {
      Active: { background: "#10b98122", color: "#10b981" },
      Trial: { background: "#3b82f622", color: "#3b82f6" },
      Suspended: { background: "#ef444422", color: "#ef4444" },
      Expired: { background: "#6b728022", color: "#6b7280" },
    };
    return { padding: "2px 10px", borderRadius: 10, fontSize: "0.75rem", fontWeight: 700, ...(map[status] || map.Trial) };
  };

  const filterCount = (status) =>
    status === "all" ? societies.length : societies.filter((s) => s.subscription?.status === status).length;

  return (
    <div style={{ padding: "2rem", maxWidth: 1400, margin: "0 auto", color: "#f0f0f0" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>Dashboard</h2>
        <p style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: 4 }}>
          Managing {stats.totalSocieties} societies · Cached data (refreshes every 5 min)
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { icon: "🏢", label: "Total Societies", value: stats.totalSocieties, accent: "#3b82f6" },
          { icon: "✅", label: "Active", value: stats.activeSocieties, accent: "#10b981" },
          { icon: "👥", label: "Total Members", value: stats.totalMembers, accent: "#7c3aed" },
          { icon: "📄", label: "Total Bills", value: stats.totalBills, accent: "#f59e0b" },
        ].map((s) => (
          <div key={s.label} style={{ background: "#111827", border: `1px solid ${s.accent}33`, borderRadius: 10, padding: "1.25rem 1.5rem", display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ fontSize: "1.75rem" }}>{s.icon}</div>
            <div>
              <div style={{ color: "#9ca3af", fontSize: "0.78rem", fontWeight: 600 }}>{s.label}</div>
              <div style={{ color: s.accent, fontSize: "1.6rem", fontWeight: 700, lineHeight: 1.2 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search societies by name, email, or reg no..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1,
            minWidth: 260,
            padding: "0.6rem 0.9rem",
            borderRadius: 8,
            border: "1px solid #374151",
            background: "#1f2937",
            color: "#f0f0f0",
            fontSize: "0.85rem",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {["all", "Active", "Trial", "Suspended"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                padding: "0.45rem 1rem",
                borderRadius: 20,
                border: "1px solid",
                borderColor: statusFilter === f ? "#3b82f6" : "#374151",
                background: statusFilter === f ? "#1d4ed8" : "transparent",
                color: statusFilter === f ? "#fff" : "#9ca3af",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {f === "all" ? "All" : f} ({filterCount(f)})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["Society Name", "Admin Credentials", "Registration No", "Contact", "Members", "Bills", "Transactions", "Status", "Plan", "Actions"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#475569", fontWeight: 700, borderBottom: "1px solid #1f2937" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredSocieties.map((society, i) => (
              <tr key={society._id} style={{ background: i % 2 === 0 ? "#111827" : "#0f172a", borderBottom: "1px solid #1a2234" }}>
                <td style={{ padding: "9px 12px", color: "#f0f0f0", fontWeight: 600 }}>{society.name}</td>
                <td style={{ padding: "9px 12px", fontSize: "0.78rem" }}>
                  {society.credentials?.adminEmail ? (
                    <div>
                      <div style={{ color: "#9ca3af" }}>{society.credentials.adminEmail}</div>
                      <div style={{ fontFamily: "monospace", color: "#10b981", fontWeight: 700 }}>
                        {society.credentials.plainPassword || "—"}
                      </div>
                    </div>
                  ) : "—"}
                </td>
                <td style={{ padding: "9px 12px", color: "#cbd5e1" }}>{society.registrationNo || "-"}</td>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ color: "#cbd5e1" }}>{society.contactEmail || "-"}</div>
                  <div style={{ color: "#6b7280", fontSize: "0.75rem" }}>{society.contactPhone || "-"}</div>
                </td>
                <td style={{ padding: "9px 12px", color: "#cbd5e1" }}>{society.stats?.members || 0}</td>
                <td style={{ padding: "9px 12px", color: "#cbd5e1" }}>{society.stats?.bills || 0}</td>
                <td style={{ padding: "9px 12px", color: "#cbd5e1" }}>{society.stats?.transactions || 0}</td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={statusBadgeStyle(society.subscription?.status || "Trial")}>
                    {society.subscription?.status || "Trial"}
                  </span>
                </td>
                <td style={{ padding: "9px 12px", color: "#cbd5e1" }}>{society.subscription?.planType || "Free"}</td>
                <td style={{ padding: "9px 12px" }}>
                  <button
                    onClick={() => router.push(`/superadmin/societies/${society._id}`)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 6,
                      border: "1px solid #3b82f6",
                      background: "transparent",
                      color: "#3b82f6",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Details →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredSocieties.length === 0 && (
          <div style={{ padding: "4rem", textAlign: "center", color: "#374151", fontSize: "0.9rem" }}>
            No societies found matching your filters
          </div>
        )}
      </div>
    </div>
  );
}
