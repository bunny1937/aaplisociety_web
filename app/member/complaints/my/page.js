"use client";
import { useState, useEffect } from "react";
import styles from "@/styles/MyComplaints.module.css";
import Link from "next/link";

const STATUS_CONFIG = {
  PENDING: { label: "Pending", cls: "yellow" },
  APPROVED: { label: "Approved", cls: "green" },
  REJECTED: { label: "Rejected", cls: "red" },
  CLOSED: { label: "Closed", cls: "gray" },
  EXPIRED: { label: "Expired", cls: "gray" },
};

export default function MyComplaintsPage() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState({});
  const [replying, setReplying] = useState({});
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState({});

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchMyComplaints = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/complaints/my", { credentials: "include" });
      const data = await res.json();
      if (res.ok) setComplaints(data.complaints);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyComplaints();
  }, []);

  const handleReply = async (complaintId) => {
    const message = replyText[complaintId]?.trim();
    if (!message || message.length < 10) {
      return showToast("Reply must be at least 10 characters", "error");
    }
    setReplying({ ...replying, [complaintId]: true });
    try {
      const res = await fetch(`/api/complaints/${complaintId}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Reply submitted");
      setReplyText({ ...replyText, [complaintId]: "" });
      fetchMyComplaints();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setReplying({ ...replying, [complaintId]: false });
    }
  };

  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1>My Complaints</h1>
          <p>Track your submitted complaints and appeals</p>
        </div>
        <Link href="/member/complaints/new" className={styles.newBtn}>
          + New
        </Link>
      </div>

      {loading ? (
        <div className={styles.loading}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : complaints.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📋</div>
          <p>You have not submitted any complaints yet.</p>
          <Link href="/member/complaints/new" className={styles.newBtn}>
            Submit First Complaint
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {complaints.map((c) => {
            const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.PENDING;
            const isRejected = c.status === "REJECTED";
            const memberReplies = (c.replies || []).filter(
              (r) => r.authorRole === "Member",
            );
            const canReply = isRejected && memberReplies.length < 3;

            return (
              <div key={c._id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <span className={`${styles.badge} ${styles[cfg.cls]}`}>
                      {cfg.label}
                    </span>
                    <span className={styles.category}>{c.category}</span>
                  </div>
                  <span className={styles.date}>
                    {new Date(c.createdAt).toLocaleDateString("en-IN")}
                  </span>
                </div>

                <h3 className={styles.title}>{c.title}</h3>
                <p className={styles.desc}>{c.description}</p>
                <p className={styles.anonName}>
                  Posted as: <strong>{c.anonymousName}</strong>
                </p>

                {/* Rejection reason */}
                {isRejected && c.adminRejectionReason && (
                  <div className={styles.rejectionBox}>
                    <strong>Admin's Reason:</strong>
                    <p>{c.adminRejectionReason}</p>
                  </div>
                )}

                {/* Reply thread */}
                {(c.replies?.length > 0 || isRejected) && (
                  <div className={styles.thread}>
                    <button
                      className={styles.toggleThread}
                      onClick={() =>
                        setExpanded({ ...expanded, [c._id]: !expanded[c._id] })
                      }
                    >
                      {expanded[c._id] ? "▲ Hide" : "▼ Show"} Thread (
                      {c.replies?.length || 0} replies)
                    </button>

                    {expanded[c._id] && (
                      <>
                        {c.replies.map((r) => (
                          <div
                            key={r._id}
                            className={`${styles.reply} ${styles[r.authorRole.toLowerCase()]}`}
                          >
                            <span className={styles.replyAuthor}>
                              {r.displayName}
                            </span>
                            <p>{r.message}</p>
                            <span className={styles.replyTime}>
                              {new Date(r.createdAt).toLocaleDateString(
                                "en-IN",
                              )}
                            </span>
                          </div>
                        ))}

                        {canReply && (
                          <div className={styles.replyForm}>
                            <textarea
                              placeholder="Write your appeal reply... (min 10 chars)"
                              rows={3}
                              value={replyText[c._id] || ""}
                              onChange={(e) =>
                                setReplyText({
                                  ...replyText,
                                  [c._id]: e.target.value,
                                })
                              }
                            />
                            <div className={styles.replyMeta}>
                              <span>
                                {3 - memberReplies.length} reply(ies) left
                              </span>
                              <button
                                onClick={() => handleReply(c._id)}
                                disabled={replying[c._id]}
                              >
                                {replying[c._id] ? "Sending..." : "Send Reply"}
                              </button>
                            </div>
                          </div>
                        )}
                        {!canReply && isRejected && (
                          <p className={styles.maxReplies}>
                            Maximum replies reached for this complaint.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
