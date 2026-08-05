"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { S } from "../ui";

const FILTERS = [
  { id: "ALL", label: "All units" },
  { id: "COMMERCIAL", label: "Shop / Office" },
  { id: "RESIDENTIAL", label: "Residential" },
  { id: "NO_LISTING", label: "Commercial, no listing yet" },
];

export default function CommercialUnitsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState([]);
  const [bulkType, setBulkType] = useState("Shop");
  const [msg, setMsg] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["commercial-units", search],
    queryFn: () =>
      apiClient.get("/api/commercial/units?q=" + encodeURIComponent(search)),
    retry: false,
  });

  const units = data?.units ?? [];
  const flatTypes = data?.flatTypes ?? [];
  const disabled = /not enabled/i.test(error?.message || "");

  const rows = useMemo(
    () =>
      units.filter((u) => {
        if (filter === "COMMERCIAL") return u.isCommercial;
        if (filter === "RESIDENTIAL") return !u.isCommercial;
        if (filter === "NO_LISTING") return u.isCommercial && !u.hasBusinessProfile;
        return true;
      }),
    [units, filter],
  );

  const classify = useMutation({
    mutationFn: (payload) => apiClient.post("/api/commercial/units", payload),
    onSuccess: (res) => {
      setSelected([]);
      if (res?.requested !== undefined) {
        const skipped = res.skipped?.length
          ? " " + res.skipped.length + " skipped (" + res.skipped[0].reason + ")"
          : "";
        setMsg("Updated " + res.changedCount + " of " + res.requested + " units." + skipped);
      } else {
        setMsg("Unit updated.");
      }
      qc.invalidateQueries({ queryKey: ["commercial-units"] });
      qc.invalidateQueries({ queryKey: ["commercial-overview"] });
    },
    onError: (e) => setMsg(e.message),
  });

  const allShown = rows.length > 0 && rows.every((r) => selected.includes(r.memberId));
  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Units</h1>
      <p style={S.sub}>
        A unit is the member record you already have. Tagging one as Shop or
        Office sets the same <b>Unit type</b> field the member screen uses - it
        does not create a second record, and nothing about ownership, tenancy or
        login changes. A unit must be tagged before it can hold a business
        listing or be charged a commercial rate.
      </p>

      {disabled && (
        <div style={{ ...S.notice, marginTop: "1rem" }}>
          The commercial module is switched off. Turn it on in{" "}
          <Link href="/admin/society-config" style={{ fontWeight: 700 }}>
            Society Config
          </Link>
          .
        </div>
      )}
      {msg && <div style={{ ...S.notice, marginTop: "1rem" }}>{msg}</div>}

      <div style={{ ...S.card, marginTop: "1rem" }}>
        <div style={S.row}>
          <input
            style={{ ...S.input, minWidth: 240 }}
            placeholder="Search flat no, wing or owner"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select style={S.input} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
            {rows.length} shown
          </span>
        </div>

        {selected.length > 0 && (
          <div
            style={{
              ...S.row,
              marginTop: "0.9rem",
              padding: "0.7rem",
              background: "#eef2ff",
              borderRadius: 8,
            }}
          >
            <b style={{ fontSize: "0.85rem" }}>{selected.length} selected</b>
            <span style={{ fontSize: "0.82rem", color: "#475569" }}>Set unit type to</span>
            <select style={S.input} value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
              {flatTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              style={S.btn}
              disabled={classify.isPending}
              onClick={() =>
                classify.mutate({ memberIds: selected, flatType: bulkType })
              }
            >
              {classify.isPending ? "Applying..." : "Apply to " + selected.length}
            </button>
            <button style={S.btnGhost} onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div style={{ ...S.card, ...S.scroll }}>
        <table style={{ ...S.table, minWidth: 860 }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 36 }}>
                <input
                  type="checkbox"
                  checked={allShown}
                  onChange={(e) =>
                    setSelected(e.target.checked ? rows.map((r) => r.memberId) : [])
                  }
                />
              </th>
              <th style={S.th}>Unit</th>
              <th style={S.th}>Owner</th>
              <th style={S.th}>Unit type</th>
              <th style={S.th}>Billing class</th>
              <th style={S.th}>Listing</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td style={S.td} colSpan={6}>
                  Loading units...
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td style={S.td} colSpan={6}>
                  No units match this filter.
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.memberId}>
                <td style={S.td}>
                  <input
                    type="checkbox"
                    checked={selected.includes(u.memberId)}
                    onChange={() => toggle(u.memberId)}
                  />
                </td>
                <td style={{ ...S.td, fontWeight: 600 }}>
                  {u.wing ? u.wing + "-" + u.flatNo : u.flatNo}
                </td>
                <td style={S.td}>{u.ownerName || "-"}</td>
                <td style={S.td}>
                  <select
                    style={S.input}
                    value={u.flatType || ""}
                    disabled={classify.isPending}
                    onChange={(e) =>
                      classify.mutate({ memberId: u.memberId, flatType: e.target.value })
                    }
                  >
                    {!u.flatType && <option value="">Not set</option>}
                    {flatTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={S.td}>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: u.isCommercial ? "#4f46e5" : "#64748b",
                    }}
                  >
                    {u.unitClass}
                  </span>
                </td>
                <td style={S.td}>
                  {u.hasBusinessProfile ? (
                    <Link href="/admin/commercial/businesses">{u.businessName}</Link>
                  ) : u.isCommercial ? (
                    <Link href="/admin/commercial/businesses">Add listing</Link>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
