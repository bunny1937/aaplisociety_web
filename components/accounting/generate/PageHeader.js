"use client";

export function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
      <div>
        <h1 style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 700, color: "#1f2937" }}>{title}</h1>
        {subtitle && <p style={{ margin: 0, fontSize: 14, color: "#6b7280" }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function FySelect({ years, value, onChange }) {
  if (!years.length) return null;
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13, background: "#fff", color: "#0f172a", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
    >
      {years.map((y) => (
        <option key={y._id} value={y._id}>{y.label}</option>
      ))}
    </select>
  );
}

export function Btn({ variant = "primary", size = "md", children, onClick, disabled, style }) {
  const base = { fontFamily: "inherit", fontWeight: 500, borderRadius: 8, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 8, transition: "all 0.2s ease", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap" };
  const sizes = { sm: { padding: "6px 12px", fontSize: 12 }, md: { padding: "10px 18px", fontSize: 14 }, lg: { padding: "12px 22px", fontSize: 15 } };
  const variants = {
    primary: { background: "#1e3a8a", color: "#fff" },
    secondary: { background: "#f3f4f6", color: "#1f2937", border: "1px solid #e5e7eb" },
    ghost: { background: "transparent", color: "#1e3a8a" },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

export function EmptyState({ text, hint }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", color: "#9ca3af" }}>
      <p style={{ margin: 0, fontSize: 14 }}>{text}</p>
      {hint && <p style={{ margin: "6px 0 0", fontSize: 13 }}>{hint}</p>}
    </div>
  );
}
