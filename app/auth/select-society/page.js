"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SelectSocietyPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const raw = sessionStorage.getItem("pendingProfiles");
    const storedName = sessionStorage.getItem("pendingName");
    if (!raw) {
      router.replace("/auth/login");
      return;
    }
    setProfiles(JSON.parse(raw));
    setName(storedName || "");
  }, []);

  const handleSelect = async (profileId) => {
    setLoading(true);
    setError("");
    try {
      const userId = sessionStorage.getItem("pendingUserId");
      const res = await fetch("/api/auth/switch-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profileId, userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to select society");

      // Clear pending state
      sessionStorage.removeItem("pendingProfiles");
      sessionStorage.removeItem("pendingUserId");
      sessionStorage.removeItem("pendingName");

      router.replace("/member/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f9fafb",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 32,
          width: 400,
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        <h2 style={{ marginBottom: 4 }}>Choose Society</h2>
        <p style={{ color: "#6b7280", marginBottom: 24 }}>
          Welcome back, {name}. Select which society to access.
        </p>

        {error && (
          <div
            style={{
              background: "#fee2e2",
              color: "#991b1b",
              padding: 12,
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {profiles.map((p) => (
            <button
              key={String(p.profileId)}
              onClick={() => handleSelect(String(p.profileId))}
              disabled={loading}
              style={{
                textAlign: "left",
                padding: "16px 20px",
                borderRadius: 10,
                border: "1.5px solid #e5e7eb",
                background: "#fff",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor = "#6366f1")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.borderColor = "#e5e7eb")
              }
            >
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                🏢 {p.societyName}
              </div>
              <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
                Flat {p.wing}-{p.flatNo} &nbsp;·&nbsp; {p.role}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
