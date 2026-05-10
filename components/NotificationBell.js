"use client";
import { useState, useRef, useEffect } from "react";
import { useNotifications } from "../hooks/useNotifications";
import NotificationToast from "./NotificationToast";
import styles from "@/styles/NotificationBell.module.css";

const TYPE_ICONS = {
  BILL_GENERATED: "🧾",
  PAYMENT_RECEIVED: "✅",
  PAYMENT_FAILED: "❌",
  DUE_REMINDER: "⏰",
  NOTICE_POSTED: "📢",
  COMPLAINT_APPROVED: "👍",
  COMPLAINT_REJECTED: "👎",
  MAINTENANCE_ALERT: "🔧",
  ADMIN_MESSAGE: "📣",
  CUSTOM: "🔔",
};

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const {
    notifications,
    unreadCount,
    loading,
    toasts,
    markRead,
    markAllRead,
    dismissToast,
  } = useNotifications();

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleOpen = () => setOpen((o) => !o);

  const handleItemClick = (n) => {
    if (!n.isRead) markRead(n._id);
    if (n.actionUrl) window.location.href = n.actionUrl;
  };

  return (
    <>
      {/* Toast container */}
      <div className={styles.toastContainer}>
        {toasts.map((t) => (
          <NotificationToast
            key={t.id}
            notification={t}
            onDismiss={() => dismissToast(t.id)}
          />
        ))}
      </div>

      {/* Bell */}
      <div className={styles.wrapper} ref={ref}>
        <button
          className={styles.bell}
          onClick={handleOpen}
          aria-label="Notifications"
        >
          🔔
          {unreadCount > 0 && (
            <span className={styles.badge}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className={styles.dropdown}>
            <div className={styles.header}>
              <span>Notifications</span>
              {unreadCount > 0 && (
                <button className={styles.markAll} onClick={markAllRead}>
                  Mark all read
                </button>
              )}
            </div>

            <div className={styles.list}>
              {loading && <div className={styles.empty}>Loading...</div>}
              {!loading && notifications.length === 0 && (
                <div className={styles.empty}>
                  <span>🔕</span>
                  <p>No notifications yet</p>
                </div>
              )}
              {notifications.map((n) => (
                <div
                  key={n._id}
                  className={`${styles.item} ${!n.isRead ? styles.unread : ""}`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className={styles.icon}>
                    {TYPE_ICONS[n.type] || "🔔"}
                  </div>
                  <div className={styles.content}>
                    <div className={styles.title}>{n.title}</div>
                    <div className={styles.message}>{n.message}</div>
                    <div className={styles.time}>{timeAgo(n.createdAt)}</div>
                  </div>
                  {!n.isRead && <div className={styles.dot} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
