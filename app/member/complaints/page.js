"use client";
import { useState, useEffect } from "react";
import styles from "@/styles/Complaints.module.css";
import Link from "next/link";
const CATEGORIES = [
  "all",
  "noise",
  "parking",
  "water",
  "security",
  "cleanliness",
  "maintenance",
  "billing",
  "staff",
  "pets",
  "other",
];
const CATEGORY_ICONS = {
  noise: "🔊",
  parking: "🚗",
  water: "💧",
  security: "🔒",
  cleanliness: "🧹",
  maintenance: "🔧",
  billing: "💰",
  staff: "👷",
  pets: "🐾",
  other: "📋",
};
export default function PublicComplaintsPage() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const fetchComplaints = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15 });
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/complaints?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setComplaints(data.complaints);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchComplaints();
  }, [category, page]);
  const timeAgo = (date) => {
    const diff = (Date.now() - new Date(date)) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };
  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div>
          <h1 className={styles.pageTitle}>Community Complaints</h1>
          <p className={styles.pageDesc}>
            Anonymous complaints approved by society admin
          </p>
        </div>
        <Link href="/member/complaints/new" className={styles.newBtn}>
          + New Complaint
        </Link>
      </div>
      <div className={styles.filters}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => {
              setCategory(c);
              setPage(1);
            }}
            className={`${styles.filterBtn} ${category === c ? styles.filterActive : ""}`}
          >
            {c !== "all" ? CATEGORY_ICONS[c] + " " : ""}
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      {loading ? (
        <div className={styles.loading}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : complaints.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📭</div>
          <p>No complaints in this category yet.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {complaints.map((c) => (
            <div key={c._id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.categoryBadge}>
                  {CATEGORY_ICONS[c.category]} {c.category}
                </span>
                <span className={styles.time}>{timeAgo(c.createdAt)}</span>
              </div>
              <h3 className={styles.cardTitle}>{c.title}</h3>
              <p className={styles.cardDesc}>{c.description}</p>
              <div className={styles.cardFooter}>
                <span className={styles.anonName}>— {c.anonymousName}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {pagination.pages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page} of {pagination.pages}
          </span>
          <button
            disabled={page >= pagination.pages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
