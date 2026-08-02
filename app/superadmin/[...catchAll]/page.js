import { redirect } from "next/navigation";
export default function SuperAdminCatchAll() {
  redirect("/superadmin/dashboard");
}
