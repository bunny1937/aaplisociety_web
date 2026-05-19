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
    <div style={{ padding: 0, maxWidth: 1400, margin: "0 auto", color: "#1f2937" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "#1f2937" }}>Dashboard</h1>
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
          <div key={s.label} style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", gap: "1rem", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "1.75rem" }}>{s.icon}</div>
            <div>
              <div style={{ color: "#6b7280", fontSize: "13px", fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
              <div style={{ color: s.accent, fontSize: "26px", fontWeight: 700, lineHeight: 1.1 }}>{s.value}</div>
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
            border: "1px solid #d1d5db",
            background: "#ffffff",
            color: "#1f2937",
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
                borderColor: statusFilter === f ? "#1e3a8a" : "#e5e7eb",
                background: statusFilter === f ? "#1e3a8a" : "#ffffff",
                color: statusFilter === f ? "#fff" : "#6b7280",
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
      <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              {["Society Name", "Admin Credentials", "Registration No", "Contact", "Members", "Bills", "Transactions", "Status", "Plan", "Actions"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#6b7280", fontWeight: 600, borderBottom: "1px solid #e5e7eb", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredSocieties.map((society, i) => (
              <tr key={society._id} style={{ background: "#ffffff", borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "10px 12px", color: "#1f2937", fontWeight: 600 }}>{society.name}</td>
                <td style={{ padding: "10px 12px", fontSize: "12px" }}>
                  {society.credentials?.adminEmail ? (
                    <div>
                      <div style={{ color: "#6b7280" }}>{society.credentials.adminEmail}</div>
                      <div style={{ fontFamily: "monospace", color: "#059669", fontWeight: 700 }}>
                        {society.credentials.plainPassword || "—"}
                      </div>
                    </div>
                  ) : "—"}
                </td>
                <td style={{ padding: "10px 12px", color: "#374151" }}>{society.registrationNo || "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ color: "#374151" }}>{society.contactEmail || "-"}</div>
                  <div style={{ color: "#9ca3af", fontSize: "12px" }}>{society.contactPhone || "-"}</div>
                </td>
                <td style={{ padding: "10px 12px", color: "#374151" }}>{society.stats?.members || 0}</td>
                <td style={{ padding: "10px 12px", color: "#374151" }}>{society.stats?.bills || 0}</td>
                <td style={{ padding: "10px 12px", color: "#374151" }}>{society.stats?.transactions || 0}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={statusBadgeStyle(society.subscription?.status || "Trial")}>
                    {society.subscription?.status || "Trial"}
                  </span>
                </td>
                <td style={{ padding: "10px 12px", color: "#374151" }}>{society.subscription?.planType || "Free"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <button
                    onClick={() => router.push(`/superadmin/societies/${society._id}`)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 6,
                      border: "1px solid #1e3a8a",
                      background: "transparent",
                      color: "#1e3a8a",
                      fontSize: "12px",
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
          <div style={{ padding: "4rem", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>
            No societies found matching your filters
          </div>
        )}
      </div>
    </div>
  );
}
