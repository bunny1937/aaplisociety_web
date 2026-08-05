"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

const S = {
  page: { padding: "1.5rem" },
  h1: { fontSize: "1.35rem", fontWeight: 700, margin: 0 },
  sub: { color: "#64748b", fontSize: "0.85rem", marginTop: "0.25rem" },
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "1rem 1.25rem",
    marginBottom: "1rem",
  },
  row: { display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" },
  input: {
    padding: "0.5rem 0.7rem",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: "0.85rem",
  },
  btn: {
    padding: "0.5rem 0.9rem",
    borderRadius: 8,
    border: "1px solid #4f46e5",
    background: "#4f46e5",
    color: "#fff",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnGhost: {
    padding: "0.5rem 0.9rem",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#334155",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" },
  th: {
    textAlign: "left",
    padding: "0.6rem 0.5rem",
    borderBottom: "2px solid #e5e7eb",
    color: "#475569",
    fontSize: "0.72rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  td: { padding: "0.55rem 0.5rem", borderBottom: "1px solid #f1f5f9" },
  scroll: { overflowX: "auto" },
  notice: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 10,
    padding: "0.85rem 1rem",
    fontSize: "0.85rem",
    marginBottom: "1rem",
  },
};

const LINKS = [
  {
    href: "/admin/commercial/units",
    title: "Units",
    body: "Tag which flats are shops or offices. Do it in bulk. A unit must be tagged before it can have a listing.",
  },
  {
    href: "/admin/commercial/businesses",
    title: "Businesses",
    body: "Create listings, fill in contact details and opening hours, publish or suspend them.",
  },
  {
    href: "/admin/commercial/categories",
    title: "Categories",
    body: "Add categories specific to this society on top of the shared list.",
  },
  {
    href: "/admin/commercial/rate-card",
    title: "Rate card",
    body: "Charge shops and offices a different amount per billing head. Compare a flat, a shop and an office side by side.",
  },
];

function Stat({ label, value, tone }) {
  return (
    <div style={{ ...S.card, flex: "1 1 160px", marginBottom: 0 }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color: tone || "#0f172a" }}>
        {value}
      </div>
      <div style={{ color: "#64748b", fontSize: "0.78rem", marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function CommercialOverviewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["commercial-overview"],
    queryFn: () => apiClient.get("/api/commercial/overview"),
    retry: false,
  });

  const disabled = /not enabled/i.test(error?.message || "");

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Commercial</h1>
      <p style={S.sub}>
        Shops and offices in this society: which units they are, what they sell,
        and what they are charged.
      </p>

      {disabled && (
        <div style={{ ...S.notice, marginTop: "1rem" }}>
          The commercial module is switched off for this society. Turn it on in{" "}
          <Link href="/admin/society-config" style={{ fontWeight: 700 }}>
            Society Config
          </Link>
          .
        </div>
      )}
      {error && !disabled && (
        <div style={{ ...S.notice, marginTop: "1rem" }}>{error.message}</div>
      )}

      <div style={{ ...S.row, marginTop: "1rem", alignItems: "stretch" }}>
        <Stat label="Units in society" value={isLoading ? "-" : (data?.units?.total ?? 0)} />
        <Stat
          label="Tagged Shop / Office"
          value={isLoading ? "-" : (data?.units?.commercial ?? 0)}
          tone="#4f46e5"
        />
        <Stat
          label="Published listings"
          value={isLoading ? "-" : (data?.listings?.PUBLISHED ?? 0)}
          tone="#047857"
        />
        <Stat label="Drafts" value={isLoading ? "-" : (data?.listings?.DRAFT ?? 0)} />
        <Stat
          label="Suspended"
          value={isLoading ? "-" : (data?.listings?.SUSPENDED ?? 0)}
          tone="#b91c1c"
        />
      </div>

      {!isLoading && !error && (data?.units?.commercial ?? 0) === 0 && (
        <div style={{ ...S.notice, marginTop: "1rem" }}>
          No unit is tagged as a Shop or an Office yet, so no business can be
          listed. Start on the{" "}
          <Link href="/admin/commercial/units" style={{ fontWeight: 700 }}>
            Units
          </Link>{" "}
          screen.
        </div>
      )}

      <div style={{ ...S.row, marginTop: "1.25rem", alignItems: "stretch" }}>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{ ...S.card, flex: "1 1 240px", marginBottom: 0, textDecoration: "none" }}
          >
            <div style={{ fontWeight: 700, color: "#0f172a" }}>{l.title}</div>
            <div style={{ color: "#64748b", fontSize: "0.8rem", marginTop: 4 }}>{l.body}</div>
          </Link>
        ))}
      </div>

      {data?.flags && (
        <div style={{ ...S.card, marginTop: "1.25rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Switches</div>
          <div style={{ fontSize: "0.83rem", color: "#475569", lineHeight: 1.8 }}>
            Module: <b>{data.flags.enabled ? "on" : "off"}</b> &nbsp;|&nbsp; Member
            directory: <b>{data.flags.directoryEnabled ? "on" : "off"}</b> &nbsp;|&nbsp;
            Owner self-editing: <b>{data.flags.ownerEditingEnabled ? "on" : "off"}</b>{" "}
            &nbsp;|&nbsp; Commercial billing:{" "}
            <b>{data.flags.commercialBillingEnabled ? "on" : "off"}</b>
            <br />
            <Link href="/admin/society-config">Change these in Society Config</Link>
          </div>
        </div>
      )}
    </div>
  );
}
