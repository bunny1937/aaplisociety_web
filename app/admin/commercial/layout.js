// app/admin/commercial/layout.js
//
// Wraps every route under /admin/commercial and applies `data-cx-theme` on
// one ancestor that every page's own `.commercial-scope` div inherits CSS
// custom properties from — see _ui/tokens.css. Harmless on routes with no
// `.commercial-scope` descendant (e.g. businesses/[id], the pre-existing
// per-listing editor, which predates this redesign): the attribute just
// has nothing to match against.
//
// The toggle button itself lives in the global sidebar (rendered by
// app/admin/layout.js via DashboardLayout's sidebarExtra slot, gated by
// the same THEMED_PATHS this file used to keep its own copy of) — not
// here. Toggling it updates the same shared theme store this layout
// subscribes to, so navigating into Commercial always reflects the
// current choice immediately.
"use client";
import { useEffect, useSyncExternalStore } from "react";
import { subscribe, getSnapshot, getServerSnapshot, hydrateFromStorage } from "./_ui/theme";

export default function CommercialLayout({ children }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    hydrateFromStorage(); // pull the real persisted choice in after mount (SSR always renders "light")
  }, []);

  return <div data-cx-theme={theme}>{children}</div>;
}