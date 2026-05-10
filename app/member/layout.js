import DashboardLayout from "components/DashboardLayout";
import NotificationBell from "components/NotificationBell";

export default function MemberLayout({ children }) {
  const navigation = [
    {
      title: "Overview",
      items: [{ name: "Dashboard", path: "/member", icon: "📊" }],
    },
    {
      title: "My Account",
      items: [
        { name: "My Profile", path: "/member/profile", icon: "👤" },
        { name: "My Bills", path: "/member/my-bills", icon: "📄" },
        { name: "My Ledger", path: "/member/my-ledger", icon: "📒" },
        { name: "Make Payment", path: "/member/make-payment", icon: "💳" },
        { name: "Receipts", path: "/member/receipts", icon: "🧾" },
        { name: "Notices", path: "/member/notices", icon: "📢" },
        { name: "Complaints", path: "/member/complaints", icon: "📝" },
      ],
    },
  ];

  return (
    <DashboardLayout
      role="Member"
      navigation={navigation}
      title="NexGen ERP"
      subtitle="Member Panel"
      headerExtra={<NotificationBell />}
    >
      {children}
    </DashboardLayout>
  );
}
