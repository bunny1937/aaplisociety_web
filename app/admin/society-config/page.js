"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";
import { produce } from "immer";
export default function SocietyConfigPage() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: "",
    registrationNo: "",
    address: "",
    config: {
      interestRate: 0,
      serviceTaxRate: 0,
      interestAfterDays: 15,
    },
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const { data: societyData, isLoading } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  useEffect(() => {
    if (societyData?.society) {
      const c = societyData.society.config || {};
      setFormData({
        name: societyData.society.name || "",
        registrationNo: societyData.society.registrationNo || "",
        address: societyData.society.address || "",
        config: {
          interestRate: c.interestRate ?? 0,
          serviceTaxRate: c.serviceTaxRate ?? 0,
          interestAfterDays: c.interestAfterDays ?? 15,
        },
      });
    }
  }, [societyData]);
  const updateMutation = useMutation({
    mutationFn: (data) => apiClient.put("/api/society/update", data),
    onSuccess: (data) => {
      setSuccessMessage("✅ Society configuration updated successfully!");
      // ✅ UPDATE FORM STATE WITH SERVER RESPONSE
      if (data.society) {
        const c = data.society.config || {};
        setFormData({
          name: data.society.name || "",
          registrationNo: data.society.registrationNo || "",
          address: data.society.address || "",
          config: {
            interestRate: c.interestRate ?? 0,
            serviceTaxRate: c.serviceTaxRate ?? 0,
            interestAfterDays: c.interestAfterDays ?? 15,
          },
        });
      }
      queryClient.invalidateQueries(["society-config"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors({ submit: error.message });
    },
  });
  const handleChange = (path, value) => {
    setFormData((prev) =>
      produce(prev, (draft) => {
        const keys = path.split(".");
        let current = draft;
        // Navigate to the parent of the target key
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            current[keys[i]] = {}; // Create if doesn't exist
          }
          current = current[keys[i]];
        }
        // Set the final value
        current[keys[keys.length - 1]] = value;
        console.log(`✅ Updated ${path} to:`, value);
      }),
    );
    if (errors[path]) {
      setErrors((prev) => ({ ...prev, [path]: "" }));
    }
  };
  const validate = () => {
    const newErrors = {};
    if (!formData.name || formData.name.trim().length < 2)
      newErrors.name = "Society name must be at least 2 characters";
    if (formData.config.interestRate < 0 || formData.config.interestRate > 100)
      newErrors.interestRate = "Interest rate must be between 0 and 100";
    if (
      formData.config.serviceTaxRate < 0 ||
      formData.config.serviceTaxRate > 100
    )
      newErrors.serviceTaxRate = "Service tax rate must be between 0 and 100";
    const afterDays = formData.config.interestAfterDays;
    if (afterDays === undefined || afterDays < 0 || afterDays > 365)
      newErrors.interestAfterDays = "Interest after days must be 0–365";
    return newErrors;
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        ...formData,
      });
      // ✅ CRITICAL: Update state with response data
      // This ensures the form shows the saved values
      console.log("✅ Save successful, state updated");
    } catch (error) {
      console.error("❌ Save failed:", error);
      setErrors({ submit: error.message });
    }
  };
  if (isLoading) {
    return (
      <div
        style={{ display: "flex", justifyContent: "center", padding: "40px" }}
      >
        <div className="loading-spinner"></div>
      </div>
    );
  }
  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Society Configuration</h1>
            <p className={styles.pageSubtitle}>
              Manage society details and financial parameters
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn btn-secondary"
            >
              🔄 Reset Changes
            </button>
            <button
              type="submit"
              className="btn btn-success"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <span className="loading-spinner"></span>
                  Saving...
                </>
              ) : (
                <>💾 Save Configuration</>
              )}
            </button>
          </div>
        </div>
        {successMessage && (
          <div
            className="toast toast-success"
            style={{ position: "relative", marginBottom: "var(--spacing-lg)" }}
          >
            {successMessage}
          </div>
        )}
        {errors.submit && (
          <div className={gridStyles.errorList}>
            <div className={gridStyles.errorListTitle}>❌ Update Failed</div>
            <div>{errors.submit}</div>
          </div>
        )}
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Basic Information</h2>
          </div>
          <div className={gridStyles.configForm}>
            <div className={gridStyles.formGroup}>
              <label className="label">Society Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                className={`input ${errors.name ? "input-error" : ""}`}
                placeholder="Green Valley Apartments"
              />
              {errors.name && <p className="error-text">{errors.name}</p>}
            </div>
            <div className={gridStyles.formRow}>
              <div className={gridStyles.formGroup}>
                <label className="label">Registration Number</label>
                <input
                  type="text"
                  value={formData.registrationNo}
                  onChange={(e) =>
                    handleChange("registrationNo", e.target.value)
                  }
                  className="input"
                  placeholder="REG/2024/1234"
                />
              </div>
            </div>
            <div className={gridStyles.formGroup}>
              <label className="label">Address</label>
              <textarea
                value={formData.address}
                onChange={(e) => handleChange("address", e.target.value)}
                className="input"
                rows="3"
                placeholder="Complete society address"
              />
            </div>
          </div>
        </div>
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Financial Parameters</h2>
          </div>
          <div className={gridStyles.formRow}>
            {/* Interest Rate on Arrears */}
            <div className={gridStyles.formGroup}>
              <label className="label">
                Interest Rate on Arrears (% per annum) *
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.config.interestRate}
                onChange={(e) =>
                  handleChange(
                    "config.interestRate",
                    parseFloat(e.target.value) || 0,
                  )
                }
                className={`input ${errors.interestRate ? "input-error" : ""}`}
                placeholder="21.00"
              />
              {errors.interestRate && (
                <p className="error-text">{errors.interestRate}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Annual interest rate on overdue payments (e.g., 21% p.a.)
              </span>
            </div>
            <div className="config-field">
              <label>Interest Rounding</label>
              <select
                value={formData.config.interestRounding || "TWO_DECIMAL"}
                onChange={(e) =>
                  handleChange("config.interestRounding", e.target.value)
                }
                className="input"
              >
                <option value="TWO_DECIMAL">
                  2 Decimal (e.g. 10.256 → 10.26)
                </option>
                <option value="ROUND_UP">
                  Round Up to whole rupee (e.g. 10.001 → 11)
                </option>
              </select>
              <p className="hint">
                Society never spares even ₹0.01 — use Round Up
              </p>
            </div>
            <div className="config-field">
              <label>Interest Use Mode</label>
              <select
                value={formData.config.interestUseMode || "OLDEST_FIRST"}
                onChange={(e) =>
                  handleChange("config.interestUseMode", e.target.value)
                }
                className="input"
              >
                <option value="OLDEST_FIRST">
                  Oldest First — clear oldest period's interest first
                </option>
                <option value="TOTAL">
                  Total Pool — treat all interest as one bucket
                </option>
              </select>
            </div>
            <div className="config-field">
              <label>Member Payment Breakdown Visible</label>
              <input
                type="checkbox"
                checked={
                  formData.config.memberPaymentBreakdownVisible !== false
                }
                onChange={(e) =>
                  handleChange(
                    "config.memberPaymentBreakdownVisible",
                    e.target.checked,
                  )
                }
              />
              <span>Show members how much goes to interest vs principal</span>
            </div>
            {/* Service Tax Rate */}
            <div className={gridStyles.formGroup}>
              <label className="label">Service Tax Rate (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formData.config.serviceTaxRate}
                onChange={(e) =>
                  handleChange(
                    "config.serviceTaxRate",
                    parseFloat(e.target.value) || 0,
                  )
                }
                className={`input ${
                  errors.serviceTaxRate ? "input-error" : ""
                }`}
                placeholder="2.00"
              />
              {errors.serviceTaxRate && (
                <p className="error-text">{errors.serviceTaxRate}</p>
              )}
              <span
                style={{
                  fontSize: "var(--font-xs)",
                  color: "var(--text-secondary)",
                }}
              >
                Tax applied on total charges (e.g., GST 2%)
              </span>
            </div>
            {/* Interest After Days — display label only, no logic gate */}
            <div style={{ gridColumn: "1 / -1", border: "1px solid #c7d2fe", borderRadius: "10px", padding: "1.25rem", background: "#f5f3ff" }}>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", color: "#4338ca", fontWeight: 700 }}>
                Interest Info
              </h3>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <label style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
                  Bill Payment Due After
                </label>
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={formData.config.interestAfterDays}
                  onChange={(e) => handleChange("config.interestAfterDays", parseInt(e.target.value) || 0)}
                  style={{ width: "80px", padding: "0.4rem 0.6rem", border: "1px solid #c7d2fe", borderRadius: "6px", fontSize: "0.875rem", textAlign: "center" }}
                />
                <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>days (shown to members — no effect on interest calculation)</span>
                {errors.interestAfterDays && <span style={{ color: "#dc2626", fontSize: "0.8rem" }}>{errors.interestAfterDays}</span>}
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
