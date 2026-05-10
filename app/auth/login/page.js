"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/Auth.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ username: "", password: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
    setApiError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const newErrors = {};
    if (!formData.username.trim())
      newErrors.username = "Username or email is required";
    if (!formData.password) newErrors.password = "Password is required";
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setApiError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // ← IMPORTANT for cookies
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
        }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("LOGIN RESPONSE:", res.status, data);

      if (!res.ok) {
        throw new Error(data.error || `Login failed (${res.status})`);
      }

      // Multi-profile: show society selector (no user field in this response)
      if (data.requiresProfileSelect) {
        // Store profiles in sessionStorage for selector screen
        sessionStorage.setItem("pendingUserId", data.userId);
        sessionStorage.setItem(
          "pendingProfiles",
          JSON.stringify(data.profiles),
        );
        sessionStorage.setItem("pendingName", data.name);
        router.replace("/auth/select-society");
        return;
      }

      const role = data.user?.role;
      if (role === "SuperAdmin") {
        router.replace("/superadmin/dashboard");
      } else if (
        role === "Secretary" ||
        role === "Admin" ||
        role === "Accountant"
      ) {
        router.replace("/admin/dashboard");
      } else {
        router.replace("/member/dashboard");
      }
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      setApiError(err.message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <h1 className={styles.authTitle}>Welcome Back</h1>
          <p className={styles.authSubtitle}>Sign in to your society account</p>
        </div>

        <form onSubmit={handleSubmit} autoComplete="off">
          {apiError && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fee2e2",
                color: "#991b1b",
                borderRadius: "var(--radius-md)",
                marginBottom: "var(--spacing-lg)",
                fontSize: "var(--font-sm)",
                fontWeight: "500",
              }}
            >
              {apiError}
            </div>
          )}

          <div className={styles.formGroup}>
            <label className="label" htmlFor="username">
              Username / Email
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="off"
              placeholder="e.g. gh_tanvib_1001_27"
              className={`input ${errors.username ? "input-error" : ""}`}
              value={formData.username}
              onChange={handleChange}
              disabled={isLoading}
            />
            {errors.username && <p className="error-text">{errors.username}</p>}
          </div>

          <div className={styles.formGroup}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className={`input ${errors.password ? "input-error" : ""}`}
              value={formData.password}
              onChange={handleChange}
              disabled={isLoading}
            />
            {errors.password && <p className="error-text">{errors.password}</p>}
          </div>

          <div className={styles.formActions}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoading}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {isLoading ? (
                <>
                  <span className="loading-spinner"></span>
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
