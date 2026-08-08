"use client";
import { useState } from "react";

export function Card({ children, padded = true, hover = false, style, onClick }) {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setH(true)}
      onMouseLeave={() => hover && setH(false)}
      style={{
        background: "var(--cx-surface)",
        border: "1px solid var(--cx-border)",
        borderRadius: "var(--cx-radius-lg)",
        padding: padded ? 18 : 0,
        boxShadow: h ? "var(--cx-shadow-pop)" : "var(--cx-shadow-card)",
        transition: "box-shadow 0.18s, transform 0.18s",
        transform: h ? "translateY(-1px)" : "none",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHead({ title, sub, right, style }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, ...style }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cx-fg-2)" }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}
