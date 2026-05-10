"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Admin.module.css";

const INPUT = {
  padding: "0.5rem",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2a2a2a",
  color: "#fff",
  width: "100%",
};

// ── Validation Rules ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]{1}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

function validateRows(rows) {
  const errors = [];
  const seenEmails = {};
  const seenNames = {};

  rows.forEach((row, idx) => {
    const r = idx + 2; // Excel row number (1=header, so data starts at 2)
    const e = (msg) => errors.push({ row: r, field: msg });

    // Required
    if (!row["Society Name"]?.toString().trim()) e("Society Name is required");
    if (!row["Address"]?.toString().trim()) e("Address is required");
    if (!row["Admin Full Name"]?.toString().trim())
      e("Admin Full Name is required");

    const adminEmail = row["Admin Email"]?.toString().trim();
    if (!adminEmail) {
      e("Admin Email is required");
    } else if (!EMAIL_RE.test(adminEmail)) {
      e(`Admin Email "${adminEmail}" is not valid`);
    } else {
      if (seenEmails[adminEmail.toLowerCase()]) {
        e(
          `Admin Email "${adminEmail}" is duplicate (also in row ${seenEmails[adminEmail.toLowerCase()]})`,
        );
      }
      seenEmails[adminEmail.toLowerCase()] = r;
    }

    const sName = row["Society Name"]?.toString().trim().toLowerCase();
    if (sName) {
      if (seenNames[sName]) {
        e(
          `Society Name "${row["Society Name"]}" is duplicate (also in row ${seenNames[sName]})`,
        );
      }
      seenNames[sName] = r;
    }

    // Optional but format-checked
    const pan = row["PAN No"]?.toString().trim();
    if (pan && !PAN_RE.test(pan))
      e(`PAN No "${pan}" must be format AAAAA0000A`);

    const tan = row["TAN No"]?.toString().trim();
    if (tan && !TAN_RE.test(tan))
      e(`TAN No "${tan}" must be format AAAA00000A`);

    const contactEmail = row["Contact Email"]?.toString().trim();
    if (contactEmail && !EMAIL_RE.test(contactEmail))
      e(`Contact Email "${contactEmail}" is not valid`);

    const phone = row["Contact Phone"]?.toString().trim().replace(/\s/g, "");
    if (phone && !PHONE_RE.test(phone))
      e(`Contact Phone "${phone}" must be 10 digits starting with 6-9`);

    const dor = row["Date of Registration"]?.toString().trim();
    if (dor) {
      const parsed = new Date(dor);
      if (isNaN(parsed.getTime()))
        e(`Date of Registration "${dor}" is not a valid date`);
      else if (parsed > new Date())
        e(`Date of Registration "${dor}" cannot be in the future`);
    }

    const ir = parseFloat(row["Interest Rate %"]);
    if (row["Interest Rate %"] !== undefined && row["Interest Rate %"] !== "") {
      if (isNaN(ir) || ir < 0 || ir > 100)
        e(
          `Interest Rate must be a number between 0–100, got "${row["Interest Rate %"]}"`,
        );
    }

    const gp = parseInt(row["Grace Period Days"]);
    if (
      row["Grace Period Days"] !== undefined &&
      row["Grace Period Days"] !== ""
    ) {
      if (isNaN(gp) || gp < 0 || gp > 365)
        e(`Grace Period Days must be 0–365, got "${row["Grace Period Days"]}"`);
    }

    const bdd = parseInt(row["Bill Due Day"]);
    if (row["Bill Due Day"] !== undefined && row["Bill Due Day"] !== "") {
      if (isNaN(bdd) || bdd < 1 || bdd > 31)
        e(`Bill Due Day must be 1–31, got "${row["Bill Due Day"]}"`);
    }

    const method = row["Interest Method"]?.toString().trim().toUpperCase();
    if (method && method !== "COMPOUND" && method !== "SIMPLE") {
      e(
        `Interest Method must be COMPOUND or SIMPLE, got "${row["Interest Method"]}"`,
      );
    }

    // Charge amounts must be numeric and non-negative
    const chargeFields = [
      "Maintenance Rate (Per Sq Ft)",
      "Sinking Fund Rate (Per Sq Ft)",
      "Repair Fund Rate (Per Sq Ft)",
      "Water Charges (Fixed)",
      "Security Charges (Fixed)",
      "Electricity Charges (Fixed)",
      "Open Parking TW (Per Vehicle)",
      "Open Parking FW (Per Vehicle)",
      "Covered Parking TW (Per Vehicle)",
      "Covered Parking FW (Per Vehicle)",
    ];
    chargeFields.forEach((f) => {
      const val = row[f];
      if (val !== undefined && val !== "") {
        const n = parseFloat(val);
        if (isNaN(n) || n < 0)
          e(`${f} must be a non-negative number, got "${val}"`);
      }
    });
  });

  return errors;
}

function rowToSocietyPayload(row) {
  const method = row["Interest Method"]?.toString().trim().toUpperCase();
  const charges = [
    {
      label: "Maintenance Charges",
      type: "Per Sq Ft",
      value: parseFloat(row["Maintenance Rate (Per Sq Ft)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Sinking Fund",
      type: "Per Sq Ft",
      value: parseFloat(row["Sinking Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Repair Fund",
      type: "Per Sq Ft",
      value: parseFloat(row["Repair Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Water Charges",
      type: "Fixed",
      value: parseFloat(row["Water Charges (Fixed)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Security Charges",
      type: "Fixed",
      value: parseFloat(row["Security Charges (Fixed)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Electricity Charges",
      type: "Fixed",
      value: parseFloat(row["Electricity Charges (Fixed)"]) || 0,
      isActive: true,
      vehicleType: null,
    },
    {
      label: "Open Parking - Two Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Open Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking TW (Per Vehicle)"]) > 0,
      vehicleType: "Two-Wheeler",
    },
    {
      label: "Open Parking - Four Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Open Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking FW (Per Vehicle)"]) > 0,
      vehicleType: "Four-Wheeler",
    },
    {
      label: "Covered Parking - Two Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Covered Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking TW (Per Vehicle)"]) > 0,
      vehicleType: "Two-Wheeler",
    },
    {
      label: "Covered Parking - Four Wheeler",
      type: "Per Vehicle",
      value: parseFloat(row["Covered Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking FW (Per Vehicle)"]) > 0,
      vehicleType: "Four-Wheeler",
    },
  ];

  return {
    societyName: row["Society Name"]?.toString().trim(),
    registrationNo: row["Registration No"]?.toString().trim() || "",
    address: row["Address"]?.toString().trim() || "",
    dateOfRegistration: row["Date of Registration"]?.toString().trim() || "",
    panNo: row["PAN No"]?.toString().trim() || "",
    tanNo: row["TAN No"]?.toString().trim() || "",
    fullName: row["Admin Full Name"]?.toString().trim(),
    email: row["Admin Email"]?.toString().trim(),
    personOfContact: row["Contact Person"]?.toString().trim() || "",
    contactEmail: row["Contact Email"]?.toString().trim() || "",
    contactPhone: row["Contact Phone"]?.toString().trim() || "",
    config: {
      charges: charges.filter((c) => c.label),
      interestRate: parseFloat(row["Interest Rate %"]) || 21,
      gracePeriodDays: parseInt(row["Grace Period Days"]) || 10,
      billDueDay: parseInt(row["Bill Due Day"]) || 10,
      interestCalculationMethod: ["COMPOUND", "SIMPLE"].includes(method)
        ? method
        : "SIMPLE",
    },
  };
}

// ── Template Download ─────────────────────────────────────────────
function downloadTemplate() {
  const headers = [
    "Society Name",
    "Registration No",
    "Address",
    "Date of Registration",
    "PAN No",
    "TAN No",
    "Admin Full Name",
    "Admin Email",
    "Contact Person",
    "Contact Email",
    "Contact Phone",
    "Interest Rate %",
    "Grace Period Days",
    "Bill Due Day",
    "Interest Method",
    "Maintenance Rate (Per Sq Ft)",
    "Sinking Fund Rate (Per Sq Ft)",
    "Repair Fund Rate (Per Sq Ft)",
    "Water Charges (Fixed)",
    "Security Charges (Fixed)",
    "Electricity Charges (Fixed)",
    "Open Parking TW (Per Vehicle)",
    "Open Parking FW (Per Vehicle)",
    "Covered Parking TW (Per Vehicle)",
    "Covered Parking FW (Per Vehicle)",
  ];

  const sample = [
    "Godbole Heights",
    "MH/2010/001",
    "Adharwadi, Kalyan, Maharashtra",
    "01/04/2010",
    "AABCG1234D",
    "MUMG12345A",
    "Ramesh Patil",
    "admin@godboleheights.com",
    "Suresh Patil",
    "secretary@godboleheights.com",
    "9876543210",
    "21",
    "10",
    "10",
    "SIMPLE",
    "1.5",
    "0.5",
    "0.25",
    "150",
    "200",
    "100",
    "100",
    "150",
    "200",
    "300",
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);

  // Column widths
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 18) }));

  // Style header row bold (basic)
  headers.forEach((_, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
    if (!ws[cellRef]) return;
    ws[cellRef].s = { font: { bold: true } };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Societies");
  XLSX.writeFile(wb, "society_upload_template.xlsx");
}

export default function AdminSocietiesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const queryClient = useQueryClient();

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [parsedRows, setParsedRows] = useState(null); // raw parsed rows
  const [validationErrors, setValidationErrors] = useState([]); // [{row, field}]
  const [uploadLoading, setUploadLoading] = useState(false);
  const [creationResults, setCreationResults] = useState(null); // [{societyName, email, password, error}]
  const [creationProgress, setCreationProgress] = useState({
    current: 0,
    total: 0,
  });

  const { data: societiesData, isLoading } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: () => apiClient.get("/api/admin/societies"),
  });

  const societies = societiesData?.societies || [];

  const filteredSocieties = societies.filter((s) => {
    const matchesSearch = s.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      filterStatus === "All" || s.subscription?.status === filterStatus;
    return matchesSearch && matchesStatus && !s.isDeleted;
  });

  const updateSubscriptionMutation = useMutation({
    mutationFn: ({ societyId, updates }) =>
      apiClient.put("/api/admin/societies", { societyId, updates }),
    onSuccess: () => {
      alert("✅ Subscription updated");
      queryClient.invalidateQueries(["admin-societies"]);
    },
  });

  const handlePaymentRecord = (societyId) => {
    const amount = parseFloat(prompt("Enter payment amount:"));
    const method = prompt("Payment method (UPI/Bank/Cash):");
    if (!amount || !method) return;
    updateSubscriptionMutation.mutate({
      societyId,
      updates: {
        "subscription.lastPaymentDate": new Date(),
        "subscription.amountPaid": amount,
        "subscription.status": "Active",
        $push: {
          "subscription.paymentHistory": {
            date: new Date(),
            amount,
            method,
            transactionId: `TXN-${Date.now()}`,
          },
        },
      },
    });
  };

  const suspendSociety = (societyId) => {
    if (!confirm("Suspend this society? They will lose access.")) return;
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { "subscription.status": "Suspended" },
    });
  };

  const activateSociety = (societyId) => {
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { "subscription.status": "Active" },
    });
  };

  // ── Excel Parse & Validate ──
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, {
          type: "binary",
          cellDates: true,
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        if (!rows.length) {
          setParsedRows([]);
          setValidationErrors([
            { row: "-", field: "File is empty or has no data rows" },
          ]);
          return;
        }

        const errors = validateRows(rows);
        setParsedRows(rows);
        setValidationErrors(errors);
        setCreationResults(null);
      } catch (err) {
        setValidationErrors([
          { row: "-", field: `Could not parse file: ${err.message}` },
        ]);
        setParsedRows(null);
      }
    };
    reader.readAsBinaryString(file);
  };

  // ── Create All Societies ──
  const handleCreateAll = async () => {
    if (!parsedRows?.length || validationErrors.length > 0) return;
    setUploadLoading(true);
    setCreationProgress({ current: 0, total: parsedRows.length });
    const results = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const payload = rowToSocietyPayload(parsedRows[i]);
      setCreationProgress({ current: i + 1, total: parsedRows.length });
      try {
        const res = await fetch("/api/admin/societies/create", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-admin-api-key": process.env.NEXT_PUBLIC_ADMIN_API_KEY,
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        results.push({
          societyName: payload.societyName,
          email: data.adminEmail,
          password: data.plainPassword,
          societyId: data.society?.societyId,
          error: null,
        });
      } catch (err) {
        results.push({
          societyName: payload.societyName,
          email: payload.email,
          password: null,
          societyId: null,
          error: err.message,
        });
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    setCreationResults(results);
    setUploadLoading(false);
    setCreationProgress({ current: 0, total: 0 });
    queryClient.invalidateQueries(["admin-societies"]);
  };

  const resetModal = () => {
    setShowAddModal(false);
    setParsedRows(null);
    setValidationErrors([]);
    setCreationResults(null);
    setCreationProgress({ current: 0, total: 0 });
  };

  const hasErrors = validationErrors.length > 0;
  const isReady =
    parsedRows && parsedRows.length > 0 && !hasErrors && !creationResults;

  return (
    <div className={styles.adminContainer}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Society Management</h1>
          <p className={styles.pageSubtitle}>
            Total: {societies.length} societies
          </p>
          <button
            onClick={() => {
              setShowAddModal(true);
              setParsedRows(null);
              setValidationErrors([]);
              setCreationResults(null);
            }}
            style={{
              background: "#10B981",
              color: "#fff",
              border: "none",
              padding: "0.6rem 1.4rem",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            + Add Society
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filtersBar}>
        <input
          type="text"
          placeholder="🔍 Search societies..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles.searchInput}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="All">All Status</option>
          <option value="Active">Active</option>
          <option value="Trial">Trial</option>
          <option value="Suspended">Suspended</option>
          <option value="Expired">Expired</option>
        </select>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard} style={{ borderColor: "#10B981" }}>
          <div className={styles.statNumber}>
            {
              societies.filter((s) => s.subscription?.status === "Active")
                .length
            }
          </div>
          <div className={styles.statLabel}>Active</div>
        </div>
        <div className={styles.statCard} style={{ borderColor: "#F59E0B" }}>
          <div className={styles.statNumber}>
            {societies.filter((s) => s.subscription?.status === "Trial").length}
          </div>
          <div className={styles.statLabel}>Trial</div>
        </div>
        <div className={styles.statCard} style={{ borderColor: "#EF4444" }}>
          <div className={styles.statNumber}>
            {
              societies.filter((s) => s.subscription?.status === "Suspended")
                .length
            }
          </div>
          <div className={styles.statLabel}>Suspended</div>
        </div>
        <div className={styles.statCard} style={{ borderColor: "#3B82F6" }}>
          <div className={styles.statNumber}>
            ₹
            {societies
              .reduce((sum, s) => sum + (s.subscription?.amountPaid || 0), 0)
              .toLocaleString()}
          </div>
          <div className={styles.statLabel}>Total Revenue</div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className={styles.loading}>Loading societies...</div>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.adminTable}>
            <thead>
              <tr>
                <th>Society Name</th>
                <th>Admin Credentials</th>
                <th>Registration</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Last Payment</th>
                <th>Next Payment</th>
                <th>Total Paid</th>
                <th>Config Ver.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSocieties.map((society) => (
                <tr key={society._id}>
                  <td>
                    <div className={styles.societyName}>{society.name}</div>
                    <div className={styles.societyId}>{society._id}</div>
                  </td>
                  <td style={{ fontSize: "0.8rem" }}>
                    {society.credentials?.adminEmail ? (
                      <div>
                        <div style={{ color: "#999" }}>
                          {society.credentials.adminEmail}
                        </div>
                        <div
                          style={{
                            fontFamily: "monospace",
                            color: "#4CAF50",
                            fontWeight: 700,
                          }}
                        >
                          {society.credentials.plainPassword || "—"}
                        </div>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{society.registrationNo || "N/A"}</td>
                  <td>
                    <span className={styles.planBadge}>
                      {society.subscription?.planType || "Free"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${styles[society.subscription?.status?.toLowerCase()]}`}
                    >
                      {society.subscription?.status || "Trial"}
                    </span>
                  </td>
                  <td>
                    {society.subscription?.lastPaymentDate
                      ? new Date(
                          society.subscription.lastPaymentDate,
                        ).toLocaleDateString("en-IN")
                      : "Never"}
                  </td>
                  <td>
                    {society.subscription?.nextPaymentDate
                      ? new Date(
                          society.subscription.nextPaymentDate,
                        ).toLocaleDateString("en-IN")
                      : "Not set"}
                  </td>
                  <td className={styles.amountCell}>
                    ₹{(society.subscription?.amountPaid || 0).toLocaleString()}
                  </td>
                  <td>v{society.configVersion || 1}</td>
                  <td>
                    <div className={styles.actionButtons}>
                      <button
                        onClick={() => handlePaymentRecord(society._id)}
                        className={styles.btnSmall}
                        style={{ background: "#10B981" }}
                      >
                        💰 Payment
                      </button>
                      {society.subscription?.status === "Active" ? (
                        <button
                          onClick={() => suspendSociety(society._id)}
                          className={styles.btnSmall}
                          style={{ background: "#EF4444" }}
                        >
                          🚫 Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => activateSociety(society._id)}
                          className={styles.btnSmall}
                          style={{ background: "#10B981" }}
                        >
                          ✅ Activate
                        </button>
                      )}
                      <button
                        onClick={() =>
                          window.open(
                            `/superadmin/society-details/${society._id}`,
                            "_blank",
                          )
                        }
                        className={styles.btnSmall}
                        style={{ background: "#3B82F6" }}
                      >
                        📊 Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredSocieties.length === 0 && (
            <div className={styles.emptyState}>
              No societies found matching your filters
            </div>
          )}
        </div>
      )}

      {/* ── ADD SOCIETY MODAL ── */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={resetModal}
        >
          <div
            style={{
              background: "#f4f4f4",
              borderRadius: 12,
              padding: "2rem",
              width: 700,
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── CREDENTIALS RESULT SCREEN ── */}
            {creationResults ? (
              <>
                <h2 style={{ color: "#10B981", marginBottom: "0.5rem" }}>
                  ✅ {creationResults.filter((r) => !r.error).length} of{" "}
                  {creationResults.length} Societies Created
                </h2>
                <p
                  style={{
                    color: "#dc2626",
                    fontSize: "0.82rem",
                    marginBottom: "1rem",
                  }}
                >
                  ⚠️ Save these credentials now — passwords will not be shown
                  again.
                </p>
                <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.82rem",
                    }}
                  >
                    <thead>
                      <tr style={{ background: "#111" }}>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Society
                        </th>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Admin Email
                        </th>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Password
                        </th>
                        <th
                          style={{
                            padding: "8px 10px",
                            textAlign: "left",
                            color: "#888",
                            borderBottom: "1px solid #333",
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {creationResults.map((r, i) => (
                        <tr
                          key={i}
                          style={{
                            background: i % 2 === 0 ? "#1e1e1e" : "#222",
                          }}
                        >
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "#fff",
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.societyName}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              color: "#ccc",
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.email}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              fontFamily: "monospace",
                              color: r.password ? "#fbbf24" : "#555",
                              fontWeight: 700,
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.password || "—"}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderBottom: "1px solid #2a2a2a",
                            }}
                          >
                            {r.error ? (
                              <span
                                style={{
                                  color: "#f87171",
                                  fontSize: "0.78rem",
                                }}
                              >
                                ❌ {r.error}
                              </span>
                            ) : (
                              <span style={{ color: "#34d399" }}>
                                ✅ Created
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => {
                      // Download credentials as CSV
                      const csv = [
                        [
                          "Society Name",
                          "Admin Email",
                          "Password",
                          "Society ID",
                          "Status",
                        ],
                        ...creationResults.map((r) => [
                          r.societyName,
                          r.email,
                          r.password || "",
                          r.societyId || "",
                          r.error || "Created",
                        ]),
                      ]
                        .map((row) => row.map((v) => `"${v}"`).join(","))
                        .join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `society_credentials_${Date.now()}.csv`;
                      a.click();
                    }}
                    style={{
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.2rem",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    ⬇️ Download Credentials CSV
                  </button>
                  <button
                    onClick={resetModal}
                    style={{
                      background: "#374151",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.2rem",
                      cursor: "pointer",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2
                  style={{
                    color: "#000000",
                    marginBottom: "0.25rem",
                    fontSize: "1.1rem",
                  }}
                >
                  📥 Add Societies via Excel
                </h2>
                <p
                  style={{
                    color: "#666",
                    fontSize: "0.82rem",
                    marginBottom: "1.5rem",
                  }}
                >
                  Download the template, fill in society data, upload and fix
                  any errors, then create.
                </p>

                {/* Step 1 — Download Template */}
                <div
                  style={{
                    background: "#f1f1f1",
                    border: "1px solid #454545",
                    borderRadius: 8,
                    padding: "1rem 1.2rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          color: "#111",
                          fontWeight: 600,
                          fontSize: "0.9rem",
                          marginBottom: 3,
                        }}
                      >
                        1. Download Template
                      </div>
                      <div style={{ color: "#666", fontSize: "0.78rem" }}>
                        25 columns — society info, admin credentials, billing
                        config, charge rates
                      </div>
                    </div>
                    <button
                      onClick={downloadTemplate}
                      style={{
                        background: "#2563eb",
                        color: "#fff",
                        border: "none",
                        padding: "8px 16px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⬇️ Download .xlsx
                    </button>
                  </div>
                </div>

                {/* Step 2 — Upload */}
                <div
                  style={{
                    background: "#f1f1f1",
                    border: "1px solid #454545",
                    borderRadius: 8,
                    padding: "1rem 1.2rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div
                    style={{
                      color: "#111",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      marginBottom: 8,
                    }}
                  >
                    2. Upload Filled Template
                  </div>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    style={{ color: "#aaa", fontSize: "0.85rem" }}
                  />
                  {parsedRows && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: "0.78rem",
                        color: "#888",
                      }}
                    >
                      Parsed{" "}
                      <strong style={{ color: "#fff" }}>
                        {parsedRows.length}
                      </strong>{" "}
                      rows
                    </div>
                  )}
                </div>

                {/* Validation Results */}
                {parsedRows && (
                  <div style={{ marginBottom: "1rem" }}>
                    {hasErrors ? (
                      <div
                        style={{
                          background: "#1a0a0a",
                          border: "1px solid #7f1d1d",
                          borderRadius: 8,
                          padding: "1rem",
                        }}
                      >
                        <div
                          style={{
                            color: "#f87171",
                            fontWeight: 700,
                            marginBottom: 8,
                            fontSize: "0.9rem",
                          }}
                        >
                          ❌ {validationErrors.length} Error
                          {validationErrors.length > 1 ? "s" : ""} Found — Fix
                          before uploading
                        </div>
                        <div style={{ maxHeight: 220, overflowY: "auto" }}>
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              fontSize: "0.78rem",
                            }}
                          >
                            <thead>
                              <tr>
                                <th
                                  style={{
                                    padding: "4px 8px",
                                    textAlign: "left",
                                    color: "#888",
                                    borderBottom: "1px solid #3a1a1a",
                                    width: 60,
                                  }}
                                >
                                  Row
                                </th>
                                <th
                                  style={{
                                    padding: "4px 8px",
                                    textAlign: "left",
                                    color: "#888",
                                    borderBottom: "1px solid #3a1a1a",
                                  }}
                                >
                                  Issue
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {validationErrors.map((err, i) => (
                                <tr key={i}>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      color: "#f87171",
                                      borderBottom: "1px solid #2a0a0a",
                                      fontWeight: 700,
                                    }}
                                  >
                                    Row {err.row}
                                  </td>
                                  <td
                                    style={{
                                      padding: "4px 8px",
                                      color: "#fca5a5",
                                      borderBottom: "1px solid #2a0a0a",
                                    }}
                                  >
                                    {err.field}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          background: "#0a1a0f",
                          border: "1px solid #065f46",
                          borderRadius: 8,
                          padding: "1rem",
                        }}
                      >
                        <div
                          style={{
                            color: "#34d399",
                            fontWeight: 700,
                            marginBottom: 6,
                            fontSize: "0.9rem",
                          }}
                        >
                          ✅ All {parsedRows.length}{" "}
                          {parsedRows.length === 1 ? "society" : "societies"}{" "}
                          passed validation
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "1.5rem",
                            fontSize: "0.78rem",
                            color: "#6ee7b7",
                          }}
                        >
                          <span>✔ Required fields present</span>
                          <span>✔ No duplicate emails/names</span>
                          <span>✔ All formats valid</span>
                          <span>✔ Charge amounts are numeric</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Preview table */}
                {isReady && (
                  <div
                    style={{
                      marginBottom: "1rem",
                      maxHeight: 180,
                      overflowY: "auto",
                      border: "1px solid #2a2a2a",
                      borderRadius: 8,
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.78rem",
                      }}
                    >
                      <thead
                        style={{
                          position: "sticky",
                          top: 0,
                          background: "#111",
                        }}
                      >
                        <tr>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            #
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Society
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Admin Email
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Interest
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              color: "#888",
                              borderBottom: "1px solid #333",
                            }}
                          >
                            Charges
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row, i) => {
                          const chargeCount = [
                            row["Maintenance Rate (Per Sq Ft)"],
                            row["Sinking Fund Rate (Per Sq Ft)"],
                            row["Repair Fund Rate (Per Sq Ft)"],
                            row["Water Charges (Fixed)"],
                            row["Security Charges (Fixed)"],
                            row["Electricity Charges (Fixed)"],
                          ].filter((v) => v !== "" && parseFloat(v) > 0).length;
                          return (
                            <tr
                              key={i}
                              style={{
                                background: i % 2 === 0 ? "#1e1e1e" : "#222",
                              }}
                            >
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#666",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {i + 1}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#fff",
                                  borderBottom: "1px solid #2a2a2a",
                                  fontWeight: 600,
                                }}
                              >
                                {row["Society Name"]}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#ccc",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {row["Admin Email"]}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#a78bfa",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {row["Interest Rate %"] || 21}%{" "}
                                {row["Interest Method"] || "SIMPLE"}
                              </td>
                              <td
                                style={{
                                  padding: "5px 10px",
                                  color: "#6ee7b7",
                                  borderBottom: "1px solid #2a2a2a",
                                }}
                              >
                                {chargeCount} heads set
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Progress bar during creation */}
                {uploadLoading && (
                  <div style={{ marginBottom: "1rem" }}>
                    <div
                      style={{
                        color: "#aaa",
                        fontSize: "0.82rem",
                        marginBottom: 6,
                      }}
                    >
                      Creating societies... {creationProgress.current}/
                      {creationProgress.total}
                    </div>
                    <div
                      style={{ height: 6, background: "#333", borderRadius: 4 }}
                    >
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 4,
                          background: "#10B981",
                          width: `${creationProgress.total ? (creationProgress.current / creationProgress.total) * 100 : 0}%`,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Footer buttons */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: "0.5rem",
                  }}
                >
                  <button
                    onClick={resetModal}
                    style={{
                      background: "#374151",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.2rem",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAll}
                    disabled={!isReady || uploadLoading}
                    style={{
                      background:
                        isReady && !uploadLoading ? "#10B981" : "#040404",
                      color: isReady && !uploadLoading ? "#fff" : "#f2f2f2",
                      border: "none",
                      borderRadius: 6,
                      padding: "0.5rem 1.6rem",
                      cursor:
                        isReady && !uploadLoading ? "pointer" : "not-allowed",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                    }}
                  >
                    {uploadLoading
                      ? `Creating ${creationProgress.current}/${creationProgress.total}...`
                      : isReady
                        ? `✅ Create ${parsedRows.length} ${parsedRows.length === 1 ? "Society" : "Societies"}`
                        : "Fix errors to continue"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
