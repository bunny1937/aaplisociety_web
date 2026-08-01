"use client";

// Live-build primitives for the Financial Statements screens — rows type out
// and totals count up section by section, no spinner-then-dump.

import { useState, useEffect } from "react";
import Icon from "./Icon";

// Matches components/accounting/StatutoryStatements.js's fmt() exactly —
// same 2-decimal accountancy formatting, same em-dash for ~zero, same
// bracketed negatives — so the live-build cards and the final statutory
// statements on the same page never show two different numbers for the
// same ledger figure.
export function fmtINR(n) {
  const v = Number(n || 0);
  if (Math.abs(v) < 0.005) return "—";
  const abs = Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(₹${abs})` : `₹${abs}`;
}

/** Reveals `text` one character at a time — the "live writing" effect. */
export function TypeText({ text, speed = 13, active = true, onDone }) {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) { setN(text.length); return; }
    if (n >= text.length) { onDone && onDone(); return; }
    const t = setTimeout(() => setN((v) => v + 1), speed);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, active]);
  const doneTyping = n >= text.length;
  return (
    <span>
      {text.slice(0, n)}
      {!doneTyping && <span style={{ opacity: 0.45, animation: "acctBlink 1s step-end infinite" }}>▍</span>}
    </span>
  );
}

/** Counts a number up from 0 to `value` — the "figure just computed" effect. */
export function CountUp({ value, duration = 450 }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = 0;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{fmtINR(display)}</>;
}

export function GroupCaption({ children }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "#9ca3af", margin: "12px 0 4px" }}>
      {children}
    </div>
  );
}

/** One line item: label left, prior (muted) + current (bold, counts up) right. */
export function MoneyRow({ label, current, prior, animated = false }) {
  const [labelDone, setLabelDone] = useState(!animated);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "7px 0", borderBottom: "1px solid #f3f4f6", animation: animated ? "acctFadeUp 0.3s ease" : "none" }}>
      <span style={{ fontSize: 13.5, color: "#374151", flex: 1 }}>
        {animated ? <TypeText text={label} onDone={() => setLabelDone(true)} /> : label}
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, opacity: labelDone ? 1 : 0, transition: "opacity 0.25s", flexShrink: 0 }}>
        {prior != null && <span style={{ fontSize: 11.5, color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>{fmtINR(prior)}</span>}
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0f172a", fontVariantNumeric: "tabular-nums", minWidth: 92, textAlign: "right" }}>
          {animated ? (labelDone ? <CountUp value={current} /> : "") : fmtINR(current)}
        </span>
      </div>
    </div>
  );
}

/** One validation/status line for the "Other" section. */
export function StatRow({ label, value, tone = "info", icon, animated = false }) {
  const [labelDone, setLabelDone] = useState(!animated);
  const colors = {
    success: { fg: "#059669", bg: "#d1fae5" },
    warning: { fg: "#92400e", bg: "#fef3c7" },
    danger: { fg: "#991b1b", bg: "#fee2e2" },
    info: { fg: "#1e40af", bg: "#dbeafe" },
  }[tone] || { fg: "#1e40af", bg: "#dbeafe" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid #f3f4f6", animation: animated ? "acctFadeUp 0.3s ease" : "none" }}>
      <span style={{ width: 26, height: 26, borderRadius: 7, background: colors.bg, color: colors.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name={icon || "check-circle"} size={14} />
      </span>
      <span style={{ flex: 1, fontSize: 13.5, color: "#374151" }}>
        {animated ? <TypeText text={label} onDone={() => setLabelDone(true)} /> : label}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.fg, opacity: labelDone ? 1 : 0, transition: "opacity 0.25s", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

/** Card wrapper: colored header, row children, optional total footer. */
export function SectionCard({ title, subtitle, accent, icon, children, totalLabel, totalCurrent, totalPrior, animated = false }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 10, background: "#f9fafb" }}>
        <span style={{ width: 34, height: 34, borderRadius: 8, background: accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={icon} size={17} />
        </span>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1f2937" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: "#6b7280" }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ padding: "4px 18px 8px" }}>{children}</div>
      {totalCurrent != null && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 18px", borderTop: "2px solid #e5e7eb", background: "#f9fafb" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1f2937" }}>{totalLabel}</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            {totalPrior != null && <span style={{ fontSize: 12, fontWeight: 500, color: "#9ca3af" }}>{fmtINR(totalPrior)}</span>}
            <span style={{ fontSize: 17, fontWeight: 800, color: accent, fontVariantNumeric: "tabular-nums" }}>
              {animated ? <CountUp value={totalCurrent} /> : fmtINR(totalCurrent)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Banner({ tone = "info", icon, children, animated = false }) {
  const colors = {
    success: { fg: "#065f46", bg: "#d1fae5" },
    danger: { fg: "#7f1d1d", bg: "#fee2e2" },
    info: { fg: "#1e40af", bg: "#dbeafe" },
  }[tone] || { fg: "#1e40af", bg: "#dbeafe" };
  return (
    <div style={{ marginTop: 14, padding: "13px 18px", borderRadius: 10, background: colors.bg, color: colors.fg, fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, animation: animated ? "acctFadeUp 0.35s ease" : "none" }}>
      <Icon name={icon} size={18} style={{ flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

export function HealthGauge({ score }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 90 ? "#059669" : pct >= 70 ? "#f59e0b" : "#dc2626";
  return (
    <div style={{ width: 140, height: 140, borderRadius: "50%", margin: "0 auto", background: `conic-gradient(${color} ${pct * 3.6}deg, #e5e7eb 0deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 108, height: 108, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 32, fontWeight: 800, color }}>{pct}</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>/ 100</div>
      </div>
    </div>
  );
}
