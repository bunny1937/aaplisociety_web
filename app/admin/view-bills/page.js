// app/admin/view-bills/page.js
// KEY FIX: downloadBill now fetches from API if billHtml is missing,
// and the download function properly opens a print window.

"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/ViewBills.module.css";

export default function ViewBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewingBill, setViewingBill] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [downloadingId, setDownloadingId] = useState(null);

  // Fetch all generated bills
  const { data: billsData, isLoading } = useQuery({
    queryKey: ["view-bills", selectedPeriod, filterStatus],
    queryFn: async () => {
      let url = "/api/billing/generated";
      const params = new URLSearchParams();
      if (selectedPeriod !== "all") params.append("period", selectedPeriod);
      if (filterStatus !== "all") params.append("status", filterStatus);
      if (params.toString()) url += `?${params.toString()}`;
      return apiClient.get(url);
    },
  });

  const bills = billsData?.bills || [];

  // Get unique periods
  const periods = [...new Set(bills.map((b) => b.billPeriodId))]
    .sort()
    .reverse();

  // Filter bills
  const filteredBills = bills.filter((bill) => {
    const matchesSearch =
      bill.memberId?.flatNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bill.memberId?.ownerName
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      bill.memberId?.wing?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  // ✅ FIXED: Download single bill - fetch HTML from API if not in object
  const downloadBill = async (bill) => {
    console.log(
      "downloadBill called, bill._id:",
      bill._id,
      "type:",
      typeof bill._id,
      "billHtml present:",
      !!bill.billHtml,
    );
    setDownloadingId(bill._id?.toString());
    try {
      let html = bill.billHtml;

      if (!html) {
        const billId = bill._id?.toString?.() || String(bill._id);
        console.log("No billHtml, fetching from API with id:", billId);
        const response = await fetch(`/api/bills/download?id=${billId}`, {
          credentials: "include",
        });
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("text/html")) {
          const blob = new Blob([await response.text()], { type: "text/html" });
          const blobUrl = URL.createObjectURL(blob);
          const printWindow = window.open(blobUrl, "_blank");
          if (!printWindow)
            alert("Popup blocked. Please allow popups for this site.");
          setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
          return;
        } else {
          // Genuine PDF blob path (if society has pdfUrl template)
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          return;
        }
      }

      if (!html) {
        alert("No bill data available for this bill. Please regenerate.");
        return;
      }

      // Build filename: ownerName_wing-flatNo_period.pdf
      const ownerRaw = bill.memberId?.ownerName || "Member";
      const nameParts = ownerRaw.trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts[nameParts.length - 1] || "";
      const nameSlug =
        nameParts.length > 1 ? `${firstName}_${lastName}` : firstName;
      const flatSlug = `${bill.memberId?.wing || ""}-${bill.memberId?.flatNo || ""}`;
      const periodSlug = bill.billPeriodId || "";
      const filename = `${nameSlug}_${flatSlug}_${periodSlug}.pdf`
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_\-\.]/g, "");

      // Give browser a frame to paint the DOM before capture
      const blob = new Blob(
        [
          `<!DOCTYPE html>
<html>
<head>
  <title>${filename.replace(".pdf", "")}</title>
  <meta charset="UTF-8"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 30px; }
    @media print {
      body { background: white; padding: 0; }
      .bill-wrapper { box-shadow: none !important; border-radius: 0 !important; }
      @page { margin: 8mm; size: A4; }
    }
  </style>
</head>
<body>
  ${html}
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 400); }<\/script>
</body>
</html>`,
        ],
        { type: "text/html" },
      );

      const blobUrl = URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, "_blank");
      if (!printWindow) {
        alert("Popup blocked. Please allow popups for this site.");
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch (error) {
      console.error("Download error:", error);
      alert("Failed to download bill: " + error.message);
    } finally {
      setDownloadingId(null);
    }
  };

  // Download all filtered bills (with delay)
  const downloadAllBills = async () => {
    if (filteredBills.length === 0) {
      alert("No bills to download");
      return;
    }
    for (const bill of filteredBills) {
      try {
        await downloadBill(bill);
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (error) {
        console.error("Failed to download bill:", bill._id);
      }
    }
  };

  // Export bills data to Excel
  const exportToExcel = async () => {
    try {
      const response = await fetch("/api/billing/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          period: selectedPeriod !== "all" ? selectedPeriod : null,
        }),
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bills-${selectedPeriod}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert("Failed to export bills");
      console.error(error);
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1>📄 View Bills</h1>
          <p>All generated bills with quick preview and download</p>
        </div>
        <div className={styles.headerActions}>
          <button onClick={exportToExcel} className="btn btn-secondary">
            📊 Export to Excel
          </button>
          <button onClick={downloadAllBills} className="btn btn-primary">
            ⬇️ Download All ({filteredBills.length})
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filtersCard}>
        <div className={styles.filterRow}>
          <div className={styles.searchBox}>
            <input
              type="text"
              placeholder="🔍 Search by flat, name, or wing..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={styles.searchInput}
            />
          </div>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className={styles.select}
          >
            <option value="all">All Periods</option>
            {periods.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={styles.select}
          >
            <option value="all">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Unpaid">Unpaid</option>
            <option value="Partial">Partial</option>
            <option value="Overdue">Overdue</option>
          </select>
          <div className={styles.resultCount}>{filteredBills.length} Bills</div>
        </div>
      </div>

      {/* Bills Grid */}
      {isLoading ? (
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>Loading bills...</p>
        </div>
      ) : filteredBills.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📭</div>
          <h3>No bills found</h3>
          <p>Try adjusting your filters or generate new bills</p>
        </div>
      ) : (
        <div className={styles.billsGrid}>
          {filteredBills.map((bill) => (
            <div key={bill._id} className={styles.billCard}>
              {/* Thumbnail Preview */}
              <div className={styles.billThumbnail}>
                <div className={styles.thumbnailHeader}>
                  <div className={styles.societyName}>
                    {bill.societyId?.name || "Society"}
                  </div>
                  <div className={styles.billNumber}>#{bill.billPeriodId}</div>
                </div>

                <div className={styles.thumbnailBody}>
                  <div className={styles.memberInfo}>
                    <div className={styles.flatNumber}>
                      {bill.memberId?.wing}-{bill.memberId?.flatNo}
                    </div>
                    <div className={styles.memberName}>
                      {bill.memberId?.ownerName}
                    </div>
                  </div>

                  <div className={styles.amountSection}>
                    <div className={styles.amountLabel}>Total Amount</div>
                    <div className={styles.amount}>
                      ₹{bill.totalAmount?.toLocaleString("en-IN")}
                    </div>
                  </div>

                  {/* Previous balance shown if > 0 */}
                  {(bill.previousBalance || 0) > 0 && (
                    <div
                      style={{
                        background: "rgba(239,68,68,0.2)",
                        borderRadius: "6px",
                        padding: "6px 10px",
                        fontSize: "12px",
                        textAlign: "center",
                      }}
                    >
                      ⚠️ Prev: ₹{bill.previousBalance?.toLocaleString("en-IN")}
                      {(bill.interestAmount || 0) > 0 && (
                        <span>
                          {" "}
                          + Int: ₹{bill.interestAmount?.toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                  )}

                  <div className={styles.statusRow}>
                    <span
                      className={`${styles.statusBadge} ${styles[bill.status?.toLowerCase()]}`}
                    >
                      {bill.status}
                    </span>
                    <span className={styles.dueDate}>
                      Due:{" "}
                      {new Date(bill.dueDate).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </div>
                </div>

                <div className={styles.thumbnailFooter}>
                  <div className={styles.chargesSummary}>
                    {bill.charges &&
                      Object.entries(bill.charges)
                        .slice(0, 3)
                        .map(([key, value]) => (
                          <div key={key} className={styles.chargeLine}>
                            <span>{key}:</span>
                            <span>₹{value}</span>
                          </div>
                        ))}
                    {bill.charges && Object.keys(bill.charges).length > 3 && (
                      <div className={styles.moreCharges}>
                        +{Object.keys(bill.charges).length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className={styles.billActions}>
                <button
                  onClick={() => setViewingBill(bill)}
                  className={styles.actionBtn}
                  title="View Full Bill"
                >
                  👁️ View
                </button>
                <button
                  onClick={() => downloadBill(bill)}
                  className={styles.actionBtn}
                  title="Download / Print Bill"
                  disabled={downloadingId === bill._id?.toString()}
                >
                  {downloadingId === bill._id ? "⏳" : "⬇️"} Download
                </button>
                <button
                  onClick={() => {
                    const url = `/api/billing/share/${bill._id}`;
                    navigator.clipboard.writeText(window.location.origin + url);
                    alert("Share link copied to clipboard!");
                  }}
                  className={styles.actionBtn}
                  title="Share Link"
                >
                  🔗 Share
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full Bill Viewer Modal */}
      {viewingBill && (
        <div className={styles.modal} onClick={() => setViewingBill(null)}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <h2>Bill Details</h2>
                <p>
                  {viewingBill.memberId?.wing}-{viewingBill.memberId?.flatNo} •{" "}
                  {viewingBill.memberId?.ownerName} • {viewingBill.billPeriodId}
                </p>
              </div>
              <button
                onClick={() => setViewingBill(null)}
                className={styles.closeBtn}
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.fullBill}>
                {viewingBill.billHtml ? (
                  <div
                    dangerouslySetInnerHTML={{ __html: viewingBill.billHtml }}
                  />
                ) : (
                  // Fallback for bills without stored HTML
                  <div>
                    <div className={styles.billHeader}>
                      <div className={styles.billLogo}>
                        <h3>{viewingBill.memberId?.ownerName}</h3>
                      </div>
                      <div className={styles.billMeta}>
                        <div>
                          <strong>Bill No:</strong> {viewingBill.billPeriodId}-
                          {viewingBill.memberId?.flatNo}
                        </div>
                        <div>
                          <strong>Date:</strong>{" "}
                          {new Date(viewingBill.createdAt).toLocaleDateString(
                            "en-IN",
                          )}
                        </div>
                        <div>
                          <strong>Due Date:</strong>{" "}
                          {new Date(viewingBill.dueDate).toLocaleDateString(
                            "en-IN",
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Previous balance section in fallback */}
                    {(viewingBill.previousBalance || 0) > 0 && (
                      <div
                        style={{
                          background: "#fee2e2",
                          border: "1px solid #fca5a5",
                          borderRadius: "8px",
                          padding: "16px",
                          marginBottom: "16px",
                        }}
                      >
                        <strong style={{ color: "#991b1b" }}>
                          ⚠️ Previous Outstanding
                        </strong>
                        <div style={{ marginTop: "8px", fontSize: "14px" }}>
                          <div>
                            Previous Balance: ₹
                            {Number(viewingBill.previousBalance).toLocaleString(
                              "en-IN",
                            )}
                          </div>
                          {(viewingBill.interestAmount || 0) > 0 && (
                            <div>
                              Interest Charged: ₹
                              {Number(
                                viewingBill.interestAmount,
                              ).toLocaleString("en-IN")}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <table className={styles.billTable}>
                      <thead>
                        <tr>
                          <th>Sr.</th>
                          <th>Particulars</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewingBill.charges &&
                          Object.entries(viewingBill.charges).map(
                            ([key, value], idx) => (
                              <tr key={key}>
                                <td>{idx + 1}</td>
                                <td>{key}</td>
                                <td>
                                  ₹{Number(value).toLocaleString("en-IN")}
                                </td>
                              </tr>
                            ),
                          )}
                        {(viewingBill.interestAmount || 0) > 0 && (
                          <tr>
                            <td>-</td>
                            <td>Interest on Arrears</td>
                            <td>
                              ₹
                              {Number(
                                viewingBill.interestAmount,
                              ).toLocaleString("en-IN")}
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        {(viewingBill.previousBalance || 0) > 0 && (
                          <tr>
                            <td colSpan={2}>
                              <strong>Previous Balance</strong>
                            </td>
                            <td>
                              <strong>
                                ₹
                                {Number(
                                  viewingBill.previousBalance,
                                ).toLocaleString("en-IN")}
                              </strong>
                            </td>
                          </tr>
                        )}
                        <tr className={styles.balance}>
                          <td colSpan={2}>
                            <strong>Total Payable</strong>
                          </td>
                          <td>
                            <strong>
                              ₹
                              {viewingBill.balanceAmount?.toLocaleString(
                                "en-IN",
                              )}
                            </strong>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                onClick={() => downloadBill(viewingBill)}
                className="btn btn-primary"
                disabled={downloadingId === viewingBill._id?.toString()}
              >
                {downloadingId === viewingBill._id
                  ? "⏳ Opening..."
                  : "⬇️ Download / Print"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
