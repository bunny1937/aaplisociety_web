"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const socketRef = useRef(null);

  // Fetch from DB (persistent)
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Connect Socket.IO for realtime
  useEffect(() => {
    fetchNotifications();

    // Get token from cookie via document.cookie (readable since not httpOnly for socket)
    // We pass token from a meta tag or dedicated endpoint
    fetch("/api/auth/token", { credentials: "include" })
      .then((r) => r.json())
      .then(({ token }) => {
        if (!token) return;

        const socket = io({
          path: "/api/socket",
          auth: { token },
        });

        socket.on("connect", () => {
          // Emit wing to join wing room
          const wing = localStorage.getItem("userWing");
          if (wing) socket.emit("join:wing", wing);
        });

        socket.on("notification:new", (notification) => {
          // Add to list at top
          setNotifications((prev) => [
            { ...notification, isRead: false },
            ...prev,
          ]);
          setUnreadCount((c) => c + 1);
          // Show toast
          setToasts((prev) => [...prev, { ...notification, id: Date.now() }]);
        });

        socketRef.current = socket;
      })
      .catch(() => {});

    return () => {
      socketRef.current?.disconnect();
    };
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
