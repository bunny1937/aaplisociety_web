"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MakePaymentPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/member/my-bills");
  }, [router]);
  return (
    <div style={{ padding: "3rem", textAlign: "center" }}>
      <div className="loading-spinner" style={{ margin: "0 auto" }}></div>
    </div>
  );
}
