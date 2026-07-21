"use client";
import { usePathname } from "next/navigation";
import SuperAdminLayout from "../../components/SuperAdminLayout";
export default function SuperAdminRootLayout({ children }) {
  const pathname = usePathname();
  if (pathname === "/superadmin/login") {
    return children;
  }
  return <SuperAdminLayout>{children}</SuperAdminLayout>;
}
