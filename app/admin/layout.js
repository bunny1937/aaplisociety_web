import DashboardLayout from "components/DashboardLayout";
import NotificationBell from "components/NotificationBell";

export default function AdminLayout({ children }) {
  const navigation = [
    {
      title: "Overview",
      items: [{ name: "Dashboard", path: "/admin/dashboard", icon: "📊" }],
    },
    {
      title: "Configuration",
      items: [
        { name: "Society Config", path: "/admin/society-config", icon: "⚙️" },
        { name: "DB Manager", path: "/admin/database-manager", icon: "📋" },
      ],
    },
    {
      title: "Members",
      items: [
        { name: "Import Members", path: "/admin/import-members", icon: "📥" },
        { name: "View Members", path: "/admin/view-members", icon: "👥" },
      ],
    },
    {
      title: "Billing",
      items: [
        { name: "Billing Template", path: "/admin/bill-template", icon: "📝" },
        { name: "Import Bills", path: "/admin/import-bills", icon: "📥" },
        { name: "Billing Config", path: "/admin/billing-config", icon: "⚙️" },
        { name: "View Bills", path: "/admin/view-bills", icon: "👁️" },
        { name: "Generate Bills", path: "/admin/generate-bills", icon: "📄" },
        { name: "Audit Report", path: "/admin/audit", icon: "📋" },
      ],
    },
    {
      title: "Transactions",
      items: [
        { name: "Ledger", path: "/admin/ledger", icon: "📖" },
        { name: "Payments", path: "/admin/payments", icon: "💳" },
        { name: "Late Payments", path: "/admin/late-payments", icon: "⚠️" }, // ← NEW
      ],
    },
    {
      title: "Communication",
      items: [
        { name: "Notices", path: "/admin/notices", icon: "📢" },
        { name: "Complaints", path: "/admin/complaints", icon: "📝" },
      ],
    },
  ];

  return (
    <DashboardLayout
      role="Admin"
      navigation={navigation}
      title="NexGen ERP"
      subtitle="Admin Panel"
      headerExtra={<NotificationBell />}
    >
      {children}
    </DashboardLayout>
  );
}
