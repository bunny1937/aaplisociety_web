// app/admin/commercial/_ui/ThemeToggle.jsx
//
// Rendered inside the global sidebar (app/admin/layout.js), which sits
// OUTSIDE any `.commercial-scope` div — so this deliberately does NOT use
// `var(--cx-*)` tokens (they'd resolve to nothing out there). Styled to
// match the sidebar's own existing icon-button look instead (see
// styles/Dashboard.module.css's .logoutBtn/.navIcon for the same palette).
"use client";
import { useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import Icon from "./Icon";
import { subscribe, getSnapshot, getServerSnapshot, toggleTheme } from "./theme";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const dark = theme === "dark";
  const [hover, setHover] = useState(false);

  const handleClick = (e) => {
    // Flood-fill transition: a circle grows from the click point out to a
    // radius that covers the farthest viewport corner, revealing the new
    // theme underneath. document.startViewTransition takes a DOM snapshot,
    // swaps it for real once our state update commits, and we animate the
    // reveal ourselves via clip-path on that new snapshot's pseudo-element.
    const x = e.clientX;
    const y = e.clientY;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      toggleTheme(); // unsupported browser or reduced-motion — instant swap, no animation
      return;
    }

    // flushSync forces React to commit the theme change's DOM mutation
    // synchronously before this callback returns, which is what lets the
    // browser's "after" snapshot for the transition actually contain the
    // new theme — without it the snapshot can race React's (batched,
    // otherwise-async) re-render and briefly capture the old colors.
    const transition = document.startViewTransition(() => flushSync(() => toggleTheme()));
    transition.ready.then(() => {
      // "ease-in-out" spends its last ~30% decelerating hard — right when
      // the circle is largest and there's the most pixels to reveal, which
      // reads as the animation stalling near the end. A near-linear curve
      // (a slight ease-out tail, no ease-in ramp-up) keeps the reveal speed
      // visually constant all the way through instead of hitching late.
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 420, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={dark ? "Switch Commercial to light mode" : "Switch Commercial to dark mode"}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 30, height: 30, borderRadius: 8, border: "1px solid #e5e7eb",
        cursor: "pointer", fontFamily: "inherit",
        background: hover ? "#eef2ff" : "transparent",
        color: hover ? "#1e3a8a" : "#475569",
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      <Icon name={dark ? "sun" : "moon"} size={15} />
    </button>
  );
}