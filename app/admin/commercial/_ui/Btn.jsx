"use client";
import Link from "next/link";
import Icon from "./Icon";

const VARIANTS = {
  primary: { background: "var(--cx-brand)", color: "var(--cx-brand-ink)", border: "1px solid var(--cx-brand)" },
  secondary: { background: "var(--cx-surface)", color: "var(--cx-fg-2)", border: "1px solid var(--cx-border)" },
  ghost: { background: "transparent", color: "var(--cx-fg-2)", border: "1px solid transparent" },
  danger: { background: "var(--cx-danger)", color: "#fff", border: "1px solid var(--cx-danger)" },
};

export default function Btn({ variant = "secondary", icon, iconR, children, onClick, disabled, type, style, href }) {
  if (href) {
    return (
      <Link href={href} style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: "7px 12px", fontSize: 13, fontWeight: 500, height: 32, borderRadius: 8,
        fontFamily: "inherit", textDecoration: "none", whiteSpace: "nowrap", ...VARIANTS[variant], ...style,
      }}>
        {icon && <Icon name={icon} size={14} />}
        {children}
        {iconR && <Icon name={iconR} size={14} />}
      </Link>
    );
  }
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: "7px 12px", fontSize: 13, fontWeight: 500, height: 32, borderRadius: 8,
        fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap", ...VARIANTS[variant], ...style,
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
      {iconR && <Icon name={iconR} size={14} />}
    </button>
  );
}
