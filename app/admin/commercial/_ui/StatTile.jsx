"use client";
import { Card } from "./Card";
import Icon from "./Icon";

export default function StatTile({ icon, label, value, hint, tone, onClick }) {
  return (
    <Card style={{ padding: 14 }} hover={!!onClick} onClick={onClick}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--cx-fg-4)", fontWeight: 500, marginBottom: 6 }}>
        {icon && <Icon name={icon} size={12} />} {label}
      </div>
      <div className="cx-num" style={{ fontSize: 22, fontWeight: 700, color: tone === "danger" ? "var(--cx-danger)" : "var(--cx-fg-1)", letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4 }}>{hint}</div>}
    </Card>
  );
}
