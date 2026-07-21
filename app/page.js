//app/page.js
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/auth/login");
  }, [router]);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      }}
    >
      <div className="loading-spinner"></div>
    </div>
  );
}
