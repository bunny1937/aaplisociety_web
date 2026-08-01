"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";

const toneColors = {
  success: { fg: "#059669", bg: "#d1fae5" },
  warning: { fg: "#92400e", bg: "#fef3c7" },
  danger: { fg: "#991b1b", bg: "#fee2e2" },
  info: { fg: "#1e40af", bg: "#dbeafe" },
};

/** One expandable health-check row: label + Passed/Failed badge, expands to reason + fix + jump-to-fix link. */
export function AccordionItem({ label, passed, reason, fix, navigationTarget, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();
  const tone = passed ? "success" : "danger";
  const colors = toneColors[tone];

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
      >
        <span style={{ width: 26, height: 26, borderRadius: 7, background: colors.bg, color: colors.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={passed ? "check-circle" : "alert-triangle"} size={14} />
        </span>
        <span style={{ flex: 1, fontSize: 13.5, color: "#374151", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", color: colors.fg, background: colors.bg, borderRadius: 999, padding: "3px 10px" }}>
          {passed ? "Passed" : "Failed"}
        </span>
        <span style={{ color: "#9ca3af", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "flex" }}>▸</span>
      </button>
      {open && (
        <div style={{ padding: "0 0 14px 38px", fontSize: 12.5, color: "#4b5563" }}>
          {reason && <div style={{ marginBottom: fix ? 8 : 0 }}>{reason}</div>}
          {!passed && fix && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", color: "#92400e", display: "flex", flexDirection: "column", gap: 8 }}>
              <span><strong>How to fix:</strong> {fix}</span>
              {navigationTarget && (
                <button
                  onClick={() => router.push(navigationTarget)}
                  style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, background: "#1e3a8a", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Go fix it <Icon name="arrow-right" size={12} />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
