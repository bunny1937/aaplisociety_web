"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import NotificationBell from "./NotificationBell";
import RouteLoadingBar from "./RouteLoadingBar";
import styles from "@/styles/Dashboard.module.css";

export default function DashboardLayout({
  children,
  role,
  navigation,
  title,
  subtitle,
  withQueryClient = false,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const navTimeoutRef = useRef(null);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            cacheTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    if (pathname.includes("/login")) return;
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setUser(data.user);
        if (data.user?.wing) localStorage.setItem("userWing", data.user.wing);
      } catch {
        if (!pathname.includes("/login")) {
          window.location.href = "/auth/login";
        }
      }
    };
    fetchUser();
  }, []);

  // Clear navigating state when route actually changes
  useEffect(() => {
    setNavigating(false);
    clearTimeout(navTimeoutRef.current);
  }, [pathname]);

  const handleNav = useCallback((path) => {
    if (pathname === path) return;
    setNavigating(true);
    // Safety fallback — clear after 3s if route never resolves
    navTimeoutRef.current = setTimeout(() => setNavigating(false), 3000);
    router.push(path);
  }, [pathname, router]);

  const handleLogout = async () => {
    localStorage.removeItem("userWing");
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/login");
  };

  if (!user) {
    return (
      <div className={styles.fullPageLoader}>
        <div className={styles.fullPageLoaderDots}>
          <div className={styles.fullPageLoaderDot} />
          <div className={styles.fullPageLoaderDot} />
          <div className={styles.fullPageLoaderDot} />
        </div>
      </div>
    );
  }

  const LayoutUI = (
    <div className={styles.dashboardContainer}>
      <RouteLoadingBar />

      {navigating && (
        <div className={styles.navLoadingOverlay}>
          <div className={styles.navLoadingSpinner} />
        </div>
      )}

      {/* SIDEBAR */}
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarLogoMark}>N</div>
          <div>
            <h1 className={styles.sidebarTitle}>{title}</h1>
            <div className={styles.sidebarSubtitle}>{subtitle}</div>
          </div>
        </div>

        {/* Nav */}
        <nav className={styles.sidebarNav}>
          {navigation.map((group, i) => (
            <div key={i} className={styles.navGroup}>
              <div className={styles.navGroupTitle}>{group.title}</div>
              {group.items.map((item) => {
                const isActive = pathname.startsWith(item.path);
                return (
                  <div
                    key={item.path}
                    className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                    onClick={() => handleNav(item.path)}
                    title={item.name}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span>{item.name}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              {user.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className={styles.userDetails}>
              <div className={styles.userName}>{user.name}</div>
              <div className={styles.userRole}>{user.role}</div>
            </div>
            <button className={styles.logoutBtn} onClick={handleLogout} title="Logout">
              <LogOut size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN AREA */}
      <div className={styles.mainWrapper}>
        {/* Top Header — transparent, sticky, right-aligned */}
        <header className={styles.topHeader}>
          <div className={styles.topHeaderLeft} />
          <div className={styles.topHeaderRight}>
            <NotificationBell />
            <div className={styles.headerUser}>
              <div className={styles.headerAvatar}>
                {user.name?.charAt(0)?.toUpperCase()}
              </div>
              <span className={styles.headerUserName}>{user.name}</span>
            </div>
          </div>
        </header>

        <main key={pathname} className={styles.mainContent}>
          {children}
        </main>
      </div>
    </div>
  );

  return withQueryClient ? (
    <QueryClientProvider client={queryClient}>{LayoutUI}</QueryClientProvider>
  ) : (
    LayoutUI
  );
}
