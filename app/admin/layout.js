"use client";
import { useEffect, useState } from "react";
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
  Wallet,
  Megaphone,
  MessageSquare,
  UserCheck,
  FileEdit,
  Zap,
  TrendingUp,
  ClipboardCheck,
} from "lucide-react";
export default function AdminLayout({ children }) {
  // Commercial module visibility. One cheap read of the society's flags; a
  // failure leaves the group hidden and never blocks the admin shell.
  const [commercialEnabled, setCommercialEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/commercial/flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.flags?.enabled) setCommercialEnabled(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
        {
          name: "Tenant Requests",
          path: "/admin/tenant-requests",
          icon: <UserCheck size={16} />,
        },
        {
          name: "Profile Changes",
          path: "/admin/profile-edit-requests",
          icon: <FileEdit size={16} />,
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
      title: "tests",
      items: [
        {
          name: "Test Page",
          path: "/admin/accounting-lab",
          icon: <ClipboardList size={16} />,
        },
      ],
    },
    {
      title: "Financial Statements",
      items: [
        {
          name: "Opening Balances",
          path: "/admin/opening-balances",
          icon: <Database size={16} />,
        },
        {
          name: "Generate Statements",
          path: "/admin/generate-statements",
          icon: <Zap size={16} />,
        },
        {
          name: "Income & Expenditure",
          path: "/admin/income-expenditure",
          icon: <TrendingUp size={16} />,
        },
        {
          name: "Assets & Liabilities",
          path: "/admin/assets-liabilities",
          icon: <BarChart3 size={16} />,
        },
        {
          name: "Trial Balance & Validation",
          path: "/admin/other-statements",
          icon: <ClipboardCheck size={16} />,
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
        {
          name: "Expenditure",
          path: "/admin/expenditure",
          icon: <Wallet size={16} />,
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
    // Commercial (additive). Rendered only for societies that switched the
    // module on, so every other sidebar is byte-identical to before.
    ...(commercialEnabled
      ? [
          {
            title: "Commercial",
            items: [
              { name: "Overview", path: "/admin/commercial", icon: "📊" },
                    { name: "Units", path: "/admin/commercial/units", icon: "🏢" },
                    { name: "Businesses", path: "/admin/commercial/businesses", icon: "🏪" },
              { name: "Categories", path: "/admin/commercial/categories", icon: "🏷️" },
                    { name: "Rate card", path: "/admin/commercial/rate-card", icon: "💰" },
            ],
          },
        ]
      : []),
    {
      title: "Amenities",
      items: [
        { name: "Overview", path: "/admin/amenities", icon: "🏠" },
        { name: "Categories", path: "/admin/amenities/categories", icon: "🗂️" },
        { name: "All Amenities", path: "/admin/amenities/list", icon: "🏊" },
        { name: "Maintenance", path: "/admin/amenities/maintenance", icon: "🔧" },
        { name: "Attendance", path: "/admin/amenities/attendance", icon: "✅" },
        { name: "Events", path: "/admin/amenities/events", icon: "🎉" },
        { name: "Analytics", path: "/admin/amenities/analytics", icon: "📊" },
        { name: "Incidents", path: "/admin/amenities/incidents", icon: "⚠️" },
        { name: "Settings", path: "/admin/amenities/settings", icon: "⚙️" },
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