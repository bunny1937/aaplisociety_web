"use client";
import Icon from "./Icon";

export default function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", padding: 3, background: "var(--cx-surface-3)", borderRadius: 9, gap: 2 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            background: active ? "var(--cx-surface)" : "transparent",
            color: active ? "var(--cx-fg-1)" : "var(--cx-fg-3)",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--cx-border)" : "none",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {o.icon && <Icon name={o.icon} size={12} />}
            {o.label}
            {o.count != null && <span style={{ opacity: 0.6, fontWeight: 500 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
