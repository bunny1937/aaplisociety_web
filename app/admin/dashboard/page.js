"use client";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import styles from "@/styles/Dashboard.module.css";

export default function AdminDashboardPage() {
  const router = useRouter();
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1); // always current month
  const [filterYear, setFilterYear] = useState(now.getFullYear()); // always current year

  // Year range: from earliest bill/payment year in DB to current+1
  // Fetched via a lightweight API call
  const [yearOptions, setYearOptions] = useState([now.getFullYear()]);

  useEffect(() => {
    fetch("/api/billing/year-range", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.minYear && d.maxYear) {
          const years = Array.from(
            { length: d.maxYear - d.minYear + 2 },
            (_, i) => d.minYear + i,
          );
          setYearOptions(years);
        }
      })
      .catch(() => {}); // silently fallback to current year
  }, []);
  const { data: membersData } = useQuery({
    queryKey: ["dashboard-members"],
    queryFn: async () => {
      const res = await fetch("/api/members/list?limit=1", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: billsData } = useQuery({
    queryKey: ["dashboard-bills", filterMonth, filterYear],
    queryFn: async () => {
      const res = await fetch(
        `/api/billing/list?month=${filterMonth}&year=${filterYear}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: paymentsData } = useQuery({
    queryKey: ["dashboard-payments", filterMonth, filterYear],
    queryFn: async () => {
      const res = await fetch(
        `/api/payments/list?limit=5&month=${filterMonth}&year=${filterYear}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: ledgerData } = useQuery({
    queryKey: ["dashboard-ledger", filterMonth, filterYear],
    queryFn: async () => {
      const res = await fetch(
        `/api/payments/list?limit=5&month=${filterMonth}&year=${filterYear}`,
        { credentials: "include" },
      );
      if (!res.ok) return { payments: [] };
      return res.json();
    },
  });

  const totalMembers = membersData?.pagination?.total || 0;
  const totalOutstanding = (billsData?.bills || []).reduce(
    (sum, b) => sum + (b.balanceAmount || b.totalAmount || 0),
    0,
  );
  const recentPayments = paymentsData?.payments || [];
  const totalCollected = recentPayments.reduce(
    (sum, p) => sum + (p.amount || 0),
    0,
  );
  const recentTransactions = ledgerData?.payments || [];
  const stats = [
    {
      label: "Total Members",
      value: totalMembers,
      icon: "👥",
      color: "#3B82F6",
      path: "/admin/view-members",
    },
    {
      label: "Total Outstanding",
      value: `₹${totalOutstanding.toLocaleString("en-IN")}`,
      icon: "⚠️",
      color: "#DC2626",
      path: "/admin/view-bills",
    },
    {
      label: "Total Collected",
      value: `₹${totalCollected.toLocaleString("en-IN")}`,
      icon: "💰",
      color: "#059669",
      path: "/admin/payments",
    },
    {
      label: "Billing Grid",
      value: "View →",
      icon: "🧮",
      color: "#7C3AED",
      path: "/admin/billing-config",
    },
  ];

  const quickLinks = [
    { label: "Generate Bills", icon: "📄", path: "/admin/generate-bills" },
    { label: "Record Payment", icon: "💳", path: "/admin/payments" },
    { label: "Import Members", icon: "📥", path: "/admin/import-members" },
    { label: "Ledger", icon: "📖", path: "/admin/ledger" },
    { label: "Bill Template", icon: "📝", path: "/admin/bill-template" },
    { label: "Society Config", icon: "⚙️", path: "/admin/society-config" },
  ];

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📊 Dashboard</h1>
          <p className={styles.pageSubtitle}>
            Welcome back — here's your society overview
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <select
            value={filterMonth}
            onChange={(e) => setFilterMonth(Number(e.target.value))}
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: 6,
              border: "1px solid #E5E7EB",
              fontSize: "0.875rem",
            }}
          >
            {[
              "Jan",
              "Feb",
              "Mar",
              "Apr",
              "May",
              "Jun",
              "Jul",
              "Aug",
              "Sep",
              "Oct",
              "Nov",
              "Dec",
            ].map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            style={{
              padding: "0.4rem 0.75rem",
              borderRadius: 6,
              border: "1px solid #E5E7EB",
              fontSize: "0.875rem",
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid} style={{ marginBottom: "2rem" }}>
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={styles.statCard}
            style={{ borderLeft: `4px solid ${stat.color}`, cursor: "pointer" }}
            onClick={() => router.push(stat.path)}
          >
            <div className={styles.statLabel}>
              {stat.icon} {stat.label}
            </div>
            <h2 className={styles.statValue} style={{ color: stat.color }}>
              {stat.value}
            </h2>
          </div>
        ))}
      </div>

      {/* Quick Links */}
      <div className={styles.contentCard} style={{ marginBottom: "2rem" }}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>⚡ Quick Actions</h2>
        </div>
        <div
          style={{
            padding: "1rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "1rem",
          }}
        >
          {quickLinks.map((link) => (
            <button
              key={link.label}
              onClick={() => router.push(link.path)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.5rem",
                padding: "1.25rem 1rem",
                background: "#F9FAFB",
                border: "1px solid #E5E7EB",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "0.875rem",
                fontWeight: "600",
                color: "#1F2937",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#EFF6FF";
                e.currentTarget.style.borderColor = "#3B82F6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#F9FAFB";
                e.currentTarget.style.borderColor = "#E5E7EB";
              }}
            >
              <span style={{ fontSize: "1.75rem" }}>{link.icon}</span>
              {link.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
        }}
      >
        {/* Recent Payments */}
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>💳 Recent Payments</h2>
            <button
              className="btn btn-secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => router.push("/admin/payments")}
            >
              View All
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            {recentPayments.length === 0 ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "#9CA3AF",
                }}
              >
                No payments yet
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      background: "#F9FAFB",
                      borderBottom: "2px solid #E5E7EB",
                    }}
                  >
                    {["Member", "Period", "Amount", "Mode"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          fontSize: "12px",
                          color: "#6B7280",
                          fontWeight: "700",
                          textTransform: "uppercase",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p, i) => (
                    <tr
                      key={p._id || i}
                      style={{ borderBottom: "1px solid #F3F4F6" }}
                    >
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "13px",
                          fontWeight: "600",
                        }}
                      >
                        {p.memberId?.wing}-{p.memberId?.flatNo}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "13px",
                          color: "#6B7280",
                        }}
                      >
                        {p.billPeriodId}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "13px",
                          fontWeight: "700",
                          color: "#059669",
                        }}
                      >
                        ₹{(p.amount || 0).toLocaleString("en-IN")}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "12px" }}>
                        <span
                          style={{
                            background: "#DBEAFE",
                            color: "#1E40AF",
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontWeight: "600",
                          }}
                        >
                          {p.paymentMode || "Cash"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>📖 Recent Ledger Entries</h2>
            <button
              className="btn btn-secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => router.push("/admin/ledger")}
            >
              View All
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            {recentTransactions.length === 0 ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "#9CA3AF",
                }}
              >
                No transactions yet
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      background: "#F9FAFB",
                      borderBottom: "2px solid #E5E7EB",
                    }}
                  >
                    {["Date", "Description", "Type", "Amount"].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: "10px 12px",
                          textAlign: "left",
                          fontSize: "12px",
                          color: "#6B7280",
                          fontWeight: "700",
                          textTransform: "uppercase",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentTransactions.map((t, i) => (
                    <tr
                      key={t._id || i}
                      style={{ borderBottom: "1px solid #F3F4F6" }}
                    >
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "12px",
                          color: "#6B7280",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {new Date(t.date).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "12px",
                          maxWidth: "160px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.description}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            background:
                              t.type === "Credit" ? "#D1FAE5" : "#FEE2E2",
                            color: t.type === "Credit" ? "#065F46" : "#991B1B",
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "11px",
                            fontWeight: "700",
                          }}
                        >
                          {t.type}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          fontSize: "13px",
                          fontWeight: "700",
                          color: t.type === "Credit" ? "#059669" : "#DC2626",
                        }}
                      >
                        ₹{(t.amount || 0).toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
