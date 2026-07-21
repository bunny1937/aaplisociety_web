"use client";
import { useState, useEffect, useCallback } from "react";
export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  // Fetch from DB (persistent)
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setNotifications((prev) => {
          // Toast any notification that's new since the last poll.
          const prevIds = new Set(prev.map((n) => n._id));
          const fresh = data.notifications.filter((n) => !prevIds.has(n._id));
          if (fresh.length && prev.length) {
            setToasts((t) => [
              ...t,
              ...fresh.map((n) => ({ ...n, id: Date.now() + Math.random() })),
            ]);
          }
          return data.notifications;
        });
        setUnreadCount(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  // No realtime push server (socket.io needs a persistent Node server, which
  // Vercel's serverless deployment doesn't run) — poll instead. Cheap, and
  // avoids an infinite reconnect loop hitting a route that never exists there.
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);
  const markRead = useCallback(async (notificationId) => {
    setNotifications((prev) =>
      prev.map((n) => (n._id === notificationId ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId }),
    });
  }, []);
  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/mark-all-read", {
      method: "POST",
      credentials: "include",
    });
  }, []);
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  return {
    notifications,
    unreadCount,
    loading,
    toasts,
    markRead,
    markAllRead,
    dismissToast,
    refetch: fetchNotifications,
  };
}
