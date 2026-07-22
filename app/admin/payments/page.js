"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";
import Select from "react-select";
export default function AdvancedPaymentPage() {
  const queryClient = useQueryClient();
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");
  const [paymentDetails, setPaymentDetails] = useState({});
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [allocationStrategy, setAllocationStrategy] = useState("oldest-first");
  const [showForecast, setShowForecast] = useState(false);
  // Fetch members
  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get("/api/members/list"),
  });
  // Fetch outstanding info when member selected
  const { data: outstandingData, isLoading: outstandingLoading } = useQuery({
    queryKey: ["outstanding", selectedMemberId],
    queryFn: () =>
      apiClient.get(`/api/payments/outstanding?memberId=${selectedMemberId}`),
    enabled: !!selectedMemberId,
  });
  // Fetch payment history for selected member
  const { data: paymentHistory } = useQuery({
    queryKey: ["payment-history", selectedMemberId],
    queryFn: () =>
      apiClient.get(
        `/api/ledger/fetch?memberId=${selectedMemberId}&category=Payment&limit=10`,
      ),
    enabled: !!selectedMemberId,
  });
  // Record payment mutation
  const recordPaymentMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/payments/record", data),
    onSuccess: () => {
      alert("✅ Payment recorded successfully!");
      queryClient.invalidateQueries(["outstanding"]);
      queryClient.invalidateQueries(["payment-history"]);
      queryClient.invalidateQueries(["ledger"]);
      resetForm();
    },
    onError: (error) => {
      alert(`❌ Error: ${error.message}`);
    },
  });
  // "Payment Done" (cash/manual acknowledgement, pending Excel confirmation).
  const markDoneMutation = useMutation({
    mutationFn: (data) => apiClient.post("/api/payments/mark-done", data),
    onSuccess: () => {
      alert("✅ Marked as Payment Done (pending Excel confirmation)");
      queryClient.invalidateQueries(["outstanding"]);
      queryClient.invalidateQueries(["pending-done"]);
      resetForm();
    },
    onError: (error) => {
      alert(`❌ Error: ${error.message}`);
    },
  });
  const { data: pendingDoneData } = useQuery({
    queryKey: ["pending-done"],
    queryFn: () => apiClient.get("/api/payments/pending-done"),
  });
  const handleMarkDone = () => {
    if (!selectedMemberId || !paymentAmount) {
      alert("Please select member and enter amount");
      return;
    }
    markDoneMutation.mutate({
      memberId: selectedMemberId,
      amount: parseFloat(paymentAmount),
      paymentMode,
      paymentDate,
      notes,
    });
  };
  const resetForm = () => {
    setSelectedMemberId("");
    setPaymentAmount("");
    setNotes("");
    setPaymentDetails({});
    setShowReceiptPreview(false);
  };
  const handleQuickPayment = (percentage) => {
    if (outstandingData?.totalOutstanding) {
      const amount = (outstandingData.totalOutstanding * percentage) / 100;
      setPaymentAmount(Math.round(amount));
    }
  };
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedMemberId || !paymentAmount) {
      alert("Please select member and enter amount");
      return;
    }
    // Guard: check if payment window is closed (billPayFinalDate from outstanding API)
    if (outstandingData?.billPayFinalDate) {
      const finalDate = new Date(outstandingData.billPayFinalDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (today > finalDate) {
        alert(
          `❌ Payment window closed.\n\nThe last date to accept payments was ${finalDate.toLocaleDateString("en-IN")}.\n\nPlease contact the admin.`,
        );
        return;
      }
    }
    const payload = {
      memberId: selectedMemberId,
      amount: parseFloat(paymentAmount),
      paymentMode,
      paymentDate,
      paymentDetails,
      notes,
    };
    recordPaymentMutation.mutate(payload);
  };
  // Transform members data for React Select
  const memberOptions =
    membersData?.members
      ?.sort((a, b) => {
        // ✅ PROPER NUMERIC SORTING
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        const roomA = parseInt(a.roomNo) || 0;
        const roomB = parseInt(b.roomNo) || 0;
        return roomA - roomB;
      })
      .map((member) => ({
        value: member._id,
        label: `${member.wing || ""}-${member.roomNo} | ${member.ownerName} | ${
          member.areaSqFt
        } sq.ft`,
        member: member,
      })) || [];
  // ✅ ADD THIS: Find the currently selected member
  const selectedMember = membersData?.members?.find(
    (m) => m._id === selectedMemberId,
  );
  const forecastInterest = (days) => {
    if (!outstandingData?.principalAmount) return 0;
    const rate = outstandingData.interestRate / 100;
    const n = outstandingData.interestCompoundingFrequency === "DAILY" ? 30 : 1;
    const t = days / 30;
    const amount =
      outstandingData.principalAmount * Math.pow(1 + rate / n, n * t);
    return Math.round((amount - outstandingData.principalAmount) * 100) / 100;
  };
  return (
    <div>
      {/* PAGE HEADER */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>💳 Advanced Payment Recording</h1>
          <p className={styles.pageSubtitle}>
            Real-time interest calculation with payment forecasting
          </p>
        </div>
      </div>
      {/* PAYMENT DONE — awaiting Excel confirmation */}
      {pendingDoneData?.bills?.length > 0 && (
        <div
          className={styles.contentCard}
          style={{ marginBottom: "1.5rem", borderLeft: "4px solid #F59E0B" }}
        >
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              🕓 Payment Done — awaiting Excel confirmation ({pendingDoneData.bills.length})
            </h2>
          </div>
          <div style={{ padding: "1rem 1.5rem", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #E5E7EB" }}>
                  <th style={{ padding: "0.5rem" }}>Flat</th>
                  <th style={{ padding: "0.5rem" }}>Member</th>
                  <th style={{ padding: "0.5rem" }}>Period</th>
                  <th style={{ padding: "0.5rem" }}>Amount</th>
                  <th style={{ padding: "0.5rem" }}>Mode</th>
                  <th style={{ padding: "0.5rem" }}>Date</th>
                  <th style={{ padding: "0.5rem" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {pendingDoneData.bills.map((b) => (
                  <tr key={b.billId} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "0.5rem" }}>{b.flat}</td>
                    <td style={{ padding: "0.5rem" }}>{b.memberName}</td>
                    <td style={{ padding: "0.5rem" }}>{b.billPeriodId}</td>
                    <td style={{ padding: "0.5rem", fontWeight: 600 }}>₹{Number(b.amount || 0).toFixed(2)}</td>
                    <td style={{ padding: "0.5rem" }}>{b.paymentMode}</td>
                    <td style={{ padding: "0.5rem" }}>{b.paymentDate ? new Date(b.paymentDate).toLocaleDateString("en-IN") : "—"}</td>
                    <td style={{ padding: "0.5rem", color: "#6B7280" }}>{b.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: "0.8rem", color: "#92400E", marginTop: "0.75rem" }}>
              These are acknowledged cash/manual payments. Upload the payment Excel to allocate them and mark the bills as <strong>Paid</strong>.
            </p>
          </div>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr",
          gap: "1.5rem",
        }}
      >
        {/* LEFT PANEL: PAYMENT FORM */}
        <div className={styles.contentCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>🔍 Member Selection</h2>
          </div>
          <form onSubmit={handleSubmit} style={{ padding: "1.5rem" }}>
            {/* MEMBER SELECTOR WITH SEARCH */}
            <div className={gridStyles.formGroup}>
              <label className="label">Select Member *</label>
              <Select
                options={memberOptions}
                value={memberOptions.find(
                  (opt) => opt.value === selectedMemberId,
                )}
                onChange={(option) => setSelectedMemberId(option?.value || "")}
                placeholder="🔍 Search by Room No, Name, or Wing..."
                isClearable
                isSearchable
                styles={{
                  control: (base) => ({
                    ...base,
                    fontSize: "1rem",
                    padding: "0.5rem",
                    borderColor: "#D1D5DB",
                    "&:hover": {
                      borderColor: "#3B82F6",
                    },
                  }),
                  option: (base, state) => ({
                    ...base,
                    backgroundColor: state.isSelected
                      ? "#3B82F6"
                      : state.isFocused
                        ? "#DBEAFE"
                        : "white",
                    color: state.isSelected ? "white" : "#1F2937",
                    fontSize: "0.9375rem",
                    padding: "0.75rem 1rem",
                  }),
                  menu: (base) => ({
                    ...base,
                    maxHeight: "300px",
                    overflowY: "auto",
                    zIndex: 9999,
                  }),
                }}
              />
              <p
                style={{
                  fontSize: "0.875rem",
                  color: "#6B7280",
                  marginTop: "0.5rem",
                }}
              >
                📊 Total Members: <strong>{memberOptions.length}</strong> | 🔍
                Type to search
              </p>
            </div>
            {/* OUTSTANDING INFO BOX */}
            {outstandingLoading && selectedMemberId && (
              <div
                style={{
                  padding: "1rem",
                  backgroundColor: "#F3F4F6",
                  borderRadius: "8px",
                  textAlign: "center",
                }}
              >
                <div className="loading-spinner"></div>
                <p>Calculating outstanding amount...</p>
              </div>
            )}
            {outstandingData && outstandingData.totalOutstanding > 0 && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "1.5rem",
                  backgroundColor:
                    outstandingData.daysOverdue > 0 ? "#FEF3C7" : "#DBEAFE",
                  border: `3px solid ${
                    outstandingData.daysOverdue > 0 ? "#F59E0B" : "#3B82F6"
                  }`,
                  borderRadius: "12px",
                }}
              >
                {/* MEMBER INFO HEADER */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "1rem",
                    paddingBottom: "1rem",
                    borderBottom: "2px solid #D1D5DB",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "1.25rem",
                        color: "#1F2937",
                      }}
                    >
                      {selectedMember?.wing}-{selectedMember?.roomNo}
                    </h3>
                    <p style={{ margin: "0.25rem 0 0 0", color: "#6B7280" }}>
                      {selectedMember?.ownerName}
                    </p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.875rem",
                        color: "#6B7280",
                      }}
                    >
                      Area
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "1.125rem",
                        fontWeight: "bold",
                      }}
                    >
                      {selectedMember?.areaSqFt} sq.ft
                    </p>
                  </div>
                </div>
                {/* OUTSTANDING BREAKDOWN */}
                <div style={{ fontSize: "0.9375rem" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "0.5rem",
                    }}
                  >
                    <span style={{ color: "#4B5563" }}>Principal Amount:</span>
                    <strong style={{ fontSize: "1.125rem" }}>
                      ₹{outstandingData.principalAmount.toLocaleString("en-IN")}
                    </strong>
                  </div>
                  {outstandingData.interestAmount > 0 && (
                    <>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "0.5rem",
                          color: "#DC2626",
                        }}
                      >
                        <span>
                          Interest ({outstandingData.daysOverdue} days overdue):
                        </span>
                        <strong style={{ fontSize: "1.125rem" }}>
                          +₹
                          {outstandingData.interestAmount.toLocaleString(
                            "en-IN",
                          )}
                        </strong>
                      </div>
                      <div
                        style={{
                          fontSize: "0.8125rem",
                          color: "#92400E",
                          backgroundColor: "#FEE2E2",
                          padding: "0.5rem",
                          borderRadius: "6px",
                          marginBottom: "0.75rem",
                        }}
                      >
                        ⚠️ Overdue since:{" "}
                        {new Date(
                          outstandingData.graceEndDate,
                        ).toLocaleDateString("en-IN")}
                        <br />
                        Interest Method:{" "}
                        {outstandingData.interestCalculationMethod} @{" "}
                        {outstandingData.interestRate}% p.a.
                      </div>
                    </>
                  )}
                  <hr style={{ margin: "0.75rem 0", borderColor: "#D1D5DB" }} />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "1.25rem",
                      fontWeight: "bold",
                      color: "#DC2626",
                    }}
                  >
                    <span>Total Outstanding:</span>
                    <span>
                      ₹
                      {outstandingData.totalOutstanding.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>
                {/* QUICK PAYMENT BUTTONS */}
                <div style={{ marginTop: "1rem" }}>
                  <p
                    style={{
                      fontSize: "0.875rem",
                      color: "#6B7280",
                      marginBottom: "0.5rem",
                    }}
                  >
                    Quick Payment:
                  </p>
                  <div
                    style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
                  >
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => handleQuickPayment(pct)}
                        className="btn btn-secondary"
                        style={{ flex: "1 1 auto", fontSize: "0.875rem" }}
                      >
                        {pct}% (₹
                        {Math.round(
                          (outstandingData.totalOutstanding * pct) / 100,
                        ).toLocaleString("en-IN")}
                        )
                      </button>
                    ))}
                  </div>
                </div>
                {/* FORECAST TOGGLE */}
                <button
                  type="button"
                  onClick={() => setShowForecast(!showForecast)}
                  style={{
                    marginTop: "1rem",
                    width: "100%",
                    padding: "0.625rem",
                    backgroundColor: "#F3F4F6",
                    border: "1px solid #D1D5DB",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                  }}
                >
                  {showForecast ? "▲ Hide" : "▼ Show"} Interest Forecast
                </button>
                {showForecast && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      padding: "0.75rem",
                      backgroundColor: "#FEE2E2",
                      borderRadius: "6px",
                      fontSize: "0.875rem",
                    }}
                  >
                    <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                      📈 Future Interest Projection:
                    </p>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.5rem",
                      }}
                    >
                      <div>
                        <span style={{ color: "#6B7280" }}>+7 days:</span>
                        <strong style={{ float: "right" }}>
                          +₹{forecastInterest(7).toLocaleString("en-IN")}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "#6B7280" }}>+15 days:</span>
                        <strong style={{ float: "right" }}>
                          +₹{forecastInterest(15).toLocaleString("en-IN")}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "#6B7280" }}>+30 days:</span>
                        <strong style={{ float: "right", color: "#DC2626" }}>
                          +₹{forecastInterest(30).toLocaleString("en-IN")}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "#6B7280" }}>+60 days:</span>
                        <strong style={{ float: "right", color: "#DC2626" }}>
                          +₹{forecastInterest(60).toLocaleString("en-IN")}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Payment window closed banner */}
            {outstandingData?.billPayFinalDate &&
              new Date() > new Date(outstandingData.billPayFinalDate) && (
                <div
                  style={{
                    background: "#FEF2F2",
                    border: "1px solid #FCA5A5",
                    borderRadius: "8px",
                    padding: "1rem",
                    marginTop: "1rem",
                    color: "#991B1B",
                    fontWeight: 600,
                    fontSize: "0.875rem",
                  }}
                >
                  🔒 Payment window closed after{" "}
                  {new Date(
                    outstandingData.billPayFinalDate,
                  ).toLocaleDateString("en-IN")}
                  . Contact admin to process outstanding dues.
                </div>
              )}
            {/* PAYMENT AMOUNT */}
            <div
              className={gridStyles.formGroup}
              style={{ marginTop: "1.5rem" }}
            >
              <label className="label">Payment Amount (₹) *</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="input"
                placeholder="Enter amount"
                style={{ fontSize: "1.25rem", fontWeight: "bold" }}
              />
              {outstandingData && paymentAmount && (
                <p
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.875rem",
                    color:
                      parseFloat(paymentAmount) >=
                      outstandingData.totalOutstanding
                        ? "#059669"
                        : "#F59E0B",
                  }}
                >
                  {parseFloat(paymentAmount) >= outstandingData.totalOutstanding
                    ? "✅ Full payment - Account will be cleared"
                    : `⚠️ Partial payment - Remaining: ₹${(
                        outstandingData.totalOutstanding -
                        parseFloat(paymentAmount)
                      ).toLocaleString("en-IN")}`}
                </p>
              )}
            </div>
            {/* PAYMENT MODE */}
            <div className={gridStyles.formGroup}>
              <label className="label">Payment Mode *</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="input"
              >
                <option value="Cash">Cash</option>
                <option value="Cheque">Cheque</option>
                <option value="Online">Online Transfer</option>
                <option value="UPI">UPI</option>
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
              </select>
            </div>
            {/* PAYMENT DATE */}
            <div className={gridStyles.formGroup}>
              <label className="label">Payment Date *</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="input"
              />
            </div>
            {/* NOTES */}
            <div className={gridStyles.formGroup}>
              <label className="label">Notes (Optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input"
                rows="3"
                placeholder="Add any additional notes..."
              />
            </div>
            {/* SUBMIT BUTTON */}
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                🔄 Reset
              </button>
              <button
                type="submit"
                className="btn btn-success"
                style={{ flex: 2 }}
                disabled={
                  !selectedMemberId ||
                  !paymentAmount ||
                  recordPaymentMutation.isPending
                }
              >
                {recordPaymentMutation.isPending ? (
                  <>
                    <span className="loading-spinner"></span> Processing...
                  </>
                ) : (
                  "💰 Record Payment"
                )}
              </button>
            </div>
            {/* CASH / MANUAL "PAYMENT DONE" (pending Excel confirmation) */}
            <button
              type="button"
              onClick={handleMarkDone}
              disabled={!selectedMemberId || !paymentAmount || markDoneMutation.isPending}
              className="btn"
              style={{ width: "100%", marginTop: "0.75rem", background: "#F59E0B", color: "white" }}
            >
              {markDoneMutation.isPending ? "Marking..." : "🕓 Mark Payment Done (cash — confirm later via Excel)"}
            </button>
          </form>
        </div>
        {/* RIGHT PANEL: PAYMENT HISTORY */}
        <div>
          {selectedMemberId && paymentHistory?.transactions?.length > 0 && (
            <div className={styles.contentCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>📜 Recent Payments</h2>
              </div>
              <div style={{ padding: "1rem" }}>
                {paymentHistory.transactions.slice(0, 5).map((txn) => (
                  <div
                    key={txn._id}
                    style={{
                      padding: "0.75rem",
                      backgroundColor: "#F9FAFB",
                      borderLeft: "4px solid #10B981",
                      marginBottom: "0.75rem",
                      borderRadius: "4px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "0.25rem",
                      }}
                    >
                      <strong style={{ color: "#059669" }}>
                        ₹{txn.amount.toLocaleString("en-IN")}
                      </strong>
                      <span style={{ fontSize: "0.875rem", color: "#6B7280" }}>
                        {new Date(txn.date).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#6B7280" }}>
                      {txn.paymentMode} • {txn.description}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}