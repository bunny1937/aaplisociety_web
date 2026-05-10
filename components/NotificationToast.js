"use client";
import { useEffect } from "react";
import styles from "@/styles/NotificationToast.module.css";

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

export default function NotificationToast({ notification, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className={styles.toast}>
      <div className={styles.icon}>{TYPE_ICONS[notification.type] || "🔔"}</div>
      <div className={styles.body}>
        <div className={styles.title}>{notification.title}</div>
        <div className={styles.message}>{notification.message}</div>
      </div>
      <button className={styles.close} onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
