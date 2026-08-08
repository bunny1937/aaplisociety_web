"use client";
const TONES = {
  paid: { bg: "var(--cx-success-soft)", fg: "var(--cx-success)" },
  published: { bg: "var(--cx-success-soft)", fg: "var(--cx-success)" },
  active: { bg: "var(--cx-success-soft)", fg: "var(--cx-success)" },
  draft: { bg: "var(--cx-warning-soft)", fg: "var(--cx-warning)" },
  partial: { bg: "var(--cx-warning-soft)", fg: "var(--cx-warning)" },
  overdue: { bg: "var(--cx-danger-soft)", fg: "var(--cx-danger)" },
  suspended: { bg: "var(--cx-danger-soft)", fg: "var(--cx-danger)" },
  unpaid: { bg: "var(--cx-danger-soft)", fg: "var(--cx-danger)" },
  info: { bg: "var(--cx-brand-soft)", fg: "var(--cx-brand)" },
  neutral: { bg: "var(--cx-surface-3)", fg: "var(--cx-fg-3)" },
};

export default function Pill({ tone = "neutral", children, dot = true, style }) {
  const t = TONES[String(tone).toLowerCase()] || TONES.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px",
      borderRadius: 999, fontSize: 11, fontWeight: 600, lineHeight: 1.4,
      background: t.bg, color: t.fg, whiteSpace: "nowrap", ...style,
    }}>
      {dot && <span className="cx-dot" />}
      {children}
    </span>
  );
}
