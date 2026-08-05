"use client";

// Admin console for the commercial module: the listings themselves, plus the
// unit tagging screen that decides which units may HAVE a listing. Both live
// here because on a real society the first question is always "which of my
// units are shops?" - and until that is answered the unit picker is empty.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

const S = {
  page: { padding: "1.5rem", maxWidth: 1200, margin: "0 auto" },
  h1: { fontSize: "1.4rem", fontWeight: 800, margin: 0 },
  sub: { color: "#64748b", fontSize: "0.85rem", margin: "0.35rem 0 1.25rem" },
  tabs: { display: "flex", gap: "0.5rem", marginBottom: "1.25rem", borderBottom: "1px solid #e2e8f0" },
  tab: (on) => ({
    padding: "0.6rem 1rem",
    fontWeight: 700,
    fontSize: "0.875rem",
    border: "none",
    background: "none",
    cursor: "pointer",
    color: on ? "#1d4ed8" : "#64748b",
    borderBottom: on ? "2px solid #1d4ed8" : "2px solid transparent",
  }),
  card: { border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", padding: "1.25rem", marginBottom: "1.25rem" },
  cardTitle: { fontSize: "1rem", fontWeight: 700, margin: "0 0 0.85rem" },
  row: { display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 200, flex: 1 },
  label: { fontSize: "0.78rem", fontWeight: 700, color: "#334155" },
  input: { padding: "0.5rem 0.65rem", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: "0.875rem", width: "100%" },
  btn: { padding: "0.55rem 0.9rem", borderRadius: 8, border: "1px solid #1d4ed8", background: "#1d4ed8", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" },
  btnGhost: { padding: "0.4rem 0.7rem", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" },
  th: { textAlign: "left", padding: "0.55rem 0.5rem", borderBottom: "1px solid #e2e8f0", color: "#64748b", fontSize: "0.75rem", textTransform: "uppercase" },
  td: { padding: "0.6rem 0.5rem", borderBottom: "1px solid #f1f5f9", verticalAlign: "middle" },
  pill: (status) => ({
    display: "inline-block",
    padding: "0.15rem 0.55rem",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 700,
    background: status === "Published" ? "#dcfce7" : status === "Suspended" ? "#fee2e2" : "#f1f5f9",
    color: status === "Published" ? "#166534" : status === "Suspended" ? "#991b1b" : "#475569",
  }),
  err: { background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: "0.85rem" },
  note: { background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: "0.85rem" },
  empty: { padding: "2rem 1rem", textAlign: "center", color: "#64748b", fontSize: "0.875rem" },
};

const unitLabel = (u) =>
  `${[u.wing, u.flatNo].filter(Boolean).join("-") || "Unit"}${u.ownerName ? ` (${u.ownerName})` : ""}`;

export default function CommercialBusinessesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("listings");

  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ memberId: "", tradeName: "", categoryId: "" });
  const [unitSearch, setUnitSearch] = useState("");
  const [error, setError] = useState("");

  const profilesQuery = useQuery({
    queryKey: ["commercial-profiles", status, search],
    queryFn: () =>
      apiClient.get(
        `/api/commercial/profiles?${new URLSearchParams({
          ...(status ? { status } : {}),
          ...(search.trim().length >= 2 ? { q: search.trim() } : {}),
        })}`,
      ),
    retry: false,
  });

  const unitsQuery = useQuery({
    queryKey: ["commercial-units"],
    queryFn: () => apiClient.get("/api/commercial/units"),
    retry: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ["commercial-categories"],
    queryFn: () => apiClient.get("/api/commercial/categories"),
    retry: false,
  });

  const units = unitsQuery.data?.units ?? [];
  const flatTypes = unitsQuery.data?.flatTypes ?? [];
  const categories = (categoriesQuery.data?.categories ?? []).filter((c) => c.isActive !== false);
  const profiles = profilesQuery.data?.profiles ?? [];

  // Only Shop/Office units without a listing can receive one. This is exactly
  // what the server enforces, shown up front instead of as a 400 later.
  const availableUnits = useMemo(
    () => units.filter((u) => u.isCommercial && !u.hasBusinessProfile),
    [units],
  );
  const commercialCount = units.filter((u) => u.isCommercial).length;

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) =>
      [u.wing, u.flatNo, u.ownerName, u.flatType].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [units, unitSearch]);

  const moduleOff = /not enabled/i.test(
    profilesQuery.error?.message || unitsQuery.error?.message || "",
  );

  const createMutation = useMutation({
    mutationFn: (payload) => apiClient.post("/api/commercial/profiles", payload),
    onSuccess: (res) => {
      const id = res?.profile?.id;
      queryClient.invalidateQueries({ queryKey: ["commercial-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["commercial-units"] });
      setForm({ memberId: "", tradeName: "", categoryId: "" });
      setError("");
      // Straight into the full editor: creation captures the minimum, the
      // editor captures everything else.
      if (id) router.push(`/admin/commercial/businesses/${id}`);
    },
    onError: (e) => setError(e.message),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, command }) => apiClient.post(`/api/commercial/profiles/${id}/${command}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commercial-profiles"] });
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  const classifyMutation = useMutation({
    mutationFn: ({ memberId, flatType }) => apiClient.post("/api/commercial/units", { memberId, flatType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commercial-units"] });
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  if (moduleOff) {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>Commercial</h1>
        <div style={S.note}>
          The commercial module is switched off for this society. Turn it on in{" "}
          <Link href="/admin/society-config">Society Config</Link>.
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Businesses</h1>
      <p style={S.sub}>
        Shops and offices inside this society. A unit must be tagged Shop or Office
        before it can have a listing, and a listing is only visible to members once
        it is published.
      </p>

      <div style={S.tabs}>
        <button type="button" style={S.tab(tab === "listings")} onClick={() => setTab("listings")}>
          Listings ({profiles.length})
        </button>
        <button type="button" style={S.tab(tab === "units")} onClick={() => setTab("units")}>
          Units ({commercialCount} commercial)
        </button>
      </div>

      {error && <div style={S.err}>{error}</div>}

      {tab === "listings" && (
        <>
          <div style={S.card}>
            <h2 style={S.cardTitle}>Add a business</h2>
            {availableUnits.length === 0 ? (
              <div style={S.note}>
                No unit is available. Either every commercial unit already has a
                listing, or no unit is tagged Shop/Office yet — open the{" "}
                <button type="button" style={S.btnGhost} onClick={() => setTab("units")}>
                  Units
                </button>{" "}
                tab and tag them first.
              </div>
            ) : (
              <div style={S.row}>
                <div style={S.field}>
                  <label style={S.label}>Unit *</label>
                  <select
                    style={S.input}
                    value={form.memberId}
                    onChange={(e) => setForm({ ...form, memberId: e.target.value })}
                  >
                    <option value="">Select a shop / office…</option>
                    {availableUnits.map((u) => (
                      <option key={u.memberId} value={u.memberId}>
                        {unitLabel(u)} — {u.flatType}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={S.field}>
                  <label style={S.label}>Business name *</label>
                  <input
                    style={S.input}
                    value={form.tradeName}
                    placeholder="Sharma Kirana Store"
                    onChange={(e) => setForm({ ...form, tradeName: e.target.value })}
                  />
                </div>
                <div style={S.field}>
                  <label style={S.label}>Category *</label>
                  <select
                    style={S.input}
                    value={form.categoryId}
                    onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  style={S.btn}
                  disabled={
                    createMutation.isPending || !form.memberId || form.tradeName.trim().length < 2 || !form.categoryId
                  }
                  onClick={() => createMutation.mutate({ ...form, tradeName: form.tradeName.trim() })}
                >
                  {createMutation.isPending ? "Creating…" : "Create & edit details"}
                </button>
              </div>
            )}
            {categories.length === 0 && (
              <div style={{ ...S.note, marginTop: "0.85rem" }}>
                No categories exist yet. Run the seed script or add one under{" "}
                <Link href="/admin/commercial/categories">Categories</Link>.
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={{ ...S.row, marginBottom: "1rem" }}>
              <div style={S.field}>
                <label style={S.label}>Search</label>
                <input
                  style={S.input}
                  value={search}
                  placeholder="Business name (min 2 characters)"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div style={{ ...S.field, maxWidth: 200 }}>
                <label style={S.label}>Status</label>
                <select style={S.input} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  <option value="Draft">Draft</option>
                  <option value="Published">Published</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>
            </div>

            {profilesQuery.isLoading ? (
              <div style={S.empty}>Loading…</div>
            ) : profiles.length === 0 ? (
              <div style={S.empty}>No listings yet.</div>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Business</th>
                    <th style={S.th}>Unit</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Last change</th>
                    <th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id}>
                      <td style={S.td}>
                        <Link href={`/admin/commercial/businesses/${p.id}`} style={{ fontWeight: 700 }}>
                          {p.tradeName}
                        </Link>
                      </td>
                      <td style={S.td}>
                        {p.unit ? `${[p.unit.wing, p.unit.flatNo].filter(Boolean).join("-")} · ${p.unit.flatType ?? ""}` : "—"}
                      </td>
                      <td style={S.td}>
                        <span style={S.pill(p.visibilityStatus)}>{p.visibilityStatus}</span>
                      </td>
                      <td style={S.td}>
                        <span style={{ color: "#64748b" }}>
                          {p.updatedReason ?? "—"}
                          {p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleDateString("en-IN")}` : ""}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <Link href={`/admin/commercial/businesses/${p.id}`} style={{ ...S.btnGhost, marginRight: 6 }}>
                          Edit
                        </Link>
                        {p.visibilityStatus !== "Published" && (
                          <button
                            type="button"
                            style={S.btnGhost}
                            disabled={transitionMutation.isPending}
                            onClick={() =>
                              transitionMutation.mutate({
                                id: p.id,
                                command: p.visibilityStatus === "Suspended" ? "reactivate" : "publish",
                              })
                            }
                          >
                            {p.visibilityStatus === "Suspended" ? "Reactivate" : "Publish"}
                          </button>
                        )}
                        {p.visibilityStatus === "Published" && (
                          <button
                            type="button"
                            style={S.btnGhost}
                            disabled={transitionMutation.isPending}
                            onClick={() => transitionMutation.mutate({ id: p.id, command: "suspend" })}
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "units" && (
        <div style={S.card}>
          <h2 style={S.cardTitle}>Tag your commercial units</h2>
          <p style={{ ...S.sub, margin: "0 0 1rem" }}>
            This sets the unit type on the member record — the same field as on the
            member screen. Only Shop and Office units can have a business listing.
            Nothing about billing, ownership or members changes here.
          </p>
          <div style={{ ...S.field, maxWidth: 320, marginBottom: "1rem" }}>
            <label style={S.label}>Search units</label>
            <input
              style={S.input}
              value={unitSearch}
              placeholder="Wing, unit number or owner"
              onChange={(e) => setUnitSearch(e.target.value)}
            />
          </div>
          {unitsQuery.isLoading ? (
            <div style={S.empty}>Loading…</div>
          ) : filteredUnits.length === 0 ? (
            <div style={S.empty}>No units found.</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Unit</th>
                  <th style={S.th}>Owner</th>
                  <th style={S.th}>Type</th>
                  <th style={S.th}>Listing</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnits.slice(0, 300).map((u) => (
                  <tr key={u.memberId}>
                    <td style={S.td}>{[u.wing, u.flatNo].filter(Boolean).join("-") || "—"}</td>
                    <td style={S.td}>{u.ownerName ?? "—"}</td>
                    <td style={S.td}>
                      <select
                        style={{ ...S.input, maxWidth: 160 }}
                        value={u.flatType ?? ""}
                        disabled={classifyMutation.isPending}
                        onChange={(e) =>
                          classifyMutation.mutate({ memberId: u.memberId, flatType: e.target.value })
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
                      {u.hasBusinessProfile ? (
                        <span style={S.pill("Published")}>{u.businessName ?? "Has listing"}</span>
                      ) : u.isCommercial ? (
                        <span style={{ color: "#64748b" }}>Ready for a listing</span>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>Residential</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filteredUnits.length > 300 && (
            <p style={S.sub}>Showing the first 300 units. Use search to narrow down.</p>
          )}
        </div>
      )}
    </div>
  );
}
