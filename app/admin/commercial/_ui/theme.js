// app/admin/commercial/_ui/theme.js
//
// Minimal theme store for the Commercial section ONLY — no other page in
// this app has a light/dark concept, so this deliberately does not touch
// `document.documentElement` or any global/app-wide storage key. State
// lives in module scope (survives client-side navigation between the 5
// Commercial pages, since they share one Next.js layout instance) and is
// persisted to localStorage under a Commercial-specific key so the choice
// sticks across reloads.
"use client";

const STORAGE_KEY = "cx-theme"; // scoped name, not a generic "theme" key
const VALID = new Set(["light", "dark"]);

function readStored() {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALID.has(v) ? v : "light";
  } catch {
    return "light"; // localStorage blocked (private mode, etc.) — default light
  }
}

let theme = "light"; // server-rendered default; corrected on mount, see useTheme
const listeners = new Set();

function setTheme(next) {
  if (!VALID.has(next) || next === theme) return;
  theme = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore — in-memory state still updates for this tab
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return theme;
}

function getServerSnapshot() {
  return "light"; // must match the pre-hydration DOM — no flash of wrong theme mismatch
}

// Called once by the layout on mount to pull the real persisted value in
// after hydration (can't read localStorage during SSR/first paint).
function hydrateFromStorage() {
  const stored = readStored();
  if (stored !== theme) setTheme(stored);
}

function toggleTheme() {
  setTheme(theme === "dark" ? "light" : "dark");
}

// The only routes where a `.commercial-scope` div actually exists (see the
// 5 redesigned pages under app/admin/commercial/). Single source of truth
// for "is the theme toggle meaningful on this page" — consumed by
// app/admin/layout.js (decides whether to show the toggle in the sidebar)
// and by app/admin/commercial/layout.js (n/a currently, kept here so any
// future consumer doesn't redefine its own copy and drift out of sync).
const THEMED_PATHS = new Set([
  "/admin/commercial",
  "/admin/commercial/rate-card",
  "/admin/commercial/units",
  "/admin/commercial/businesses",
  "/admin/commercial/categories",
]);

export {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  hydrateFromStorage,
  setTheme,
  toggleTheme,
  THEMED_PATHS,
};