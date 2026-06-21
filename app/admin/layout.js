"use client";

import DashboardLayout from "components/DashboardLayout";
import {
  LayoutDashboard,
  Settings,
  Database,
  UserPlus,
  Users,
  FileText,
  Upload,
  Eye,
  FileSpreadsheet,
  ClipboardList,
  BookOpen,
  CreditCard,
  AlertTriangle,
  BarChart3,
  Megaphone,
  MessageSquare,
} from "lucide-react";

export default function AdminLayout({ children }) {
  const navigation = [
    {
      title: "Overview",
      items: [
        {
          name: "Dashboard",
          path: "/admin/dashboard",
          icon: <LayoutDashboard size={16} />,
        },
      ],
    },
    {
      title: "Configuration",
      items: [
        {
          name: "Society Config",
          path: "/admin/society-config",
          icon: <Settings size={16} />,
        },
        {
          name: "DB Manager",
          path: "/admin/database-manager",
          icon: <Database size={16} />,
        },
      ],
    },
    {
      title: "Members",
      items: [
        {
          name: "Import Members",
          path: "/admin/import-members",
          icon: <UserPlus size={16} />,
        },
        {
          name: "View Members",
          path: "/admin/view-members",
          icon: <Users size={16} />,
        },
      ],
    },
    {
      title: "Billing",
      items: [
        {
          name: "Billing Template",
          path: "/admin/bill-template",
          icon: <FileText size={16} />,
        },
        {
          name: "Import Bills",
          path: "/admin/import-bills",
          icon: <Upload size={16} />,
        },
        {
          name: "Billing Config",
          path: "/admin/billing-config",
          icon: <Settings size={16} />,
        },
        {
          name: "View Bills",
          path: "/admin/view-bills",
          icon: <Eye size={16} />,
        },
        {
          name: "Generate Bills",
          path: "/admin/generate-bills",
          icon: <FileSpreadsheet size={16} />,
        },
        {
          name: "Audit Report",
          path: "/admin/audit",
          icon: <ClipboardList size={16} />,
        },
      ],
    },
    {
      title: "Transactions",
      items: [
        { name: "Ledger", path: "/admin/ledger", icon: <BookOpen size={16} /> },
        {
          name: "Payments",
          path: "/admin/payments",
          icon: <CreditCard size={16} />,
        },
        {
          name: "Receipts",
          path: "/admin/receipts",
          icon: <FileText size={16} />,
        },
        {
          name: "Late Payments",
          path: "/admin/late-payments",
          icon: <AlertTriangle size={16} />,
        },
        {
          name: "Balance Sheet",
          path: "/admin/balance-sheet",
          icon: <BarChart3 size={16} />,
        },
      ],
    },
    {
      title: "Communication",
      items: [
        {
          name: "Notices",
          path: "/admin/notices",
          icon: <Megaphone size={16} />,
        },
        {
          name: "Complaints",
          path: "/admin/complaints",
          icon: <MessageSquare size={16} />,
        },
      ],
    },
    {
      title: "Security",
      items: [
        { name: "Visitors", path: "/admin/visitors", icon: "🚪" },
        { name: "Active Visitors", path: "/admin/visitors/active", icon: "🟢" },
        { name: "Visitor Log", path: "/admin/visitors/log", icon: "📋" },
        { name: "Security Guards", path: "/admin/security-guards", icon: "👮" },
        { name: "Offline Audit", path: "/admin/visitors/audit", icon: "🗂️" },
        { name: "Watchlist", path: "/admin/blacklist", icon: "⛔" },
      ],
    },
  ];

  return (
    <DashboardLayout
      role="Admin"
      navigation={navigation}
      title="NexGen ERP"
      subtitle="Admin Panel"
    >
      {children}
    </DashboardLayout>
  );
}
