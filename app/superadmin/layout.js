"use client";

import { usePathname } from "next/navigation";
import DashboardLayout from "../../components/DashboardLayout";

export default function SuperAdminLayout({ children }) {
  const pathname = usePathname();

  // 🔥 CRITICAL FIX: skip dashboard layout for login page
  if (pathname === "/superadmin/login") {
    return children;
  }

  const navigation = [
    {
      title: "Overview",
      items: [{ name: "Dashboard", path: "/superadmin/dashboard", icon: "📊" }],
    },
    {
      title: "Super Admin",
      items: [
        { name: "Societies", path: "/superadmin/societies", icon: "🏢" },
        { name: "Audit Reports", path: "superadmin/audit-reports", icon: "📋" },
        { name: "Data Browser", path: "/superadmin/data-browser", icon: "🗄️" },
        { name: "Logs", path: "/superadmin/logs", icon: "📜" },
        { name: "Exports", path: "/superadmin/exports", icon: "📦" },
      ],
    },
  ];

  return (
    <DashboardLayout
      role="SuperAdmin"
      navigation={navigation}
      title="NexGen ERP"
      subtitle="Super Admin"
      withQueryClient={true}
    >
      {children}
    </DashboardLayout>
  );
}
