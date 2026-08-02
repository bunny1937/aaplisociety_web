import { redirect } from "next/navigation";
export default function SecurityCatchAll() {
  redirect("/security/dashboard");
}
