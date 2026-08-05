"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { S } from "../ui";

// Commercial rate card — Shop/Office only, no residential column ever.
// Residential rates continue to live on /admin/billing-config, untouched.
// See docs/superpowers/specs/2026-08-05-commercial-billing-separation-design.md
const TABS = ["Shop", "Office"];
const GST_WARN_THRESHOLD = 7500; // spec: GST flag-only, ₹7,500/unit/month

export default function CommercialRateCardPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("Shop");
  const [area, setArea] = useState(300);
  const [newHead, setNewHead] = useState({ headName: "", calculationType: "Fixed", rate: "" });
  const [msg, setMsg] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["commercial-billing-heads"],
    queryFn: () => apiClient.get("/api/commercial/billing-heads"),
    retry: false,
  });
  const { data: flagsData, error: flagsError } = useQuery({
    queryKey: ["commercial-flags"],
    queryFn: () => apiClient.get("/api/commercial/flags"),
    retry: false,
  });

  const heads = (data?.heads ?? []).filter((h) => h.categoryScope.includes(tab));
  const billingOn = flagsData?.flags?.commercialBillingEnabled === true;
  const moduleOff = /not enabled/i.test(flagsError?.message || "") || flagsData?.flags?.enabled === false;

  const monthlyTotal = useMemo(() => {
    let running = 0;
    for (const h of heads) {
      if (h.isActive === false) continue;
      const rate = Number(h.rate?.[tab]) || 0;
      if (h.calculationType === "Per Sq Ft") running += Number(area || 0) * rate;
      else if (h.calculationType === "Percentage") running += running * (rate / 100);
      else running += rate;
    }
    return running;
  }, [heads, area, tab]);
  const gstWarn = monthlyTotal > GST_WARN_THRESHOLD;

  const update = useMutation({
    mutationFn: ({ id, patch }) => apiClient.put(`/api/commercial/billing-heads/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commercial-billing-heads"] }),
    onError: (e) => setMsg(e.message),
  });

  const create = useMutation({
    mutationFn: (payload) => apiClient.post("/api/commercial/billing-heads", payload),
    onSuccess: () => {
      setNewHead({ headName: "", calculationType: "Fixed", rate: "" });
      qc.invalidateQueries({ queryKey: ["commercial-billing-heads"] });
    },
    onError: (e) => setMsg(e.message),
  });

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Commercial rate card</h1>
      <p style={S.sub}>
        Shops and offices only — this page never shows a residential rate.
        Set what each category pays per head below.
      </p>

      {moduleOff && (
        <div style={{ ...S.notice, marginTop: "1rem" }}>
          The commercial module is off. Turn it on in{" "}
          <Link href="/admin/society-config" style={{ fontWeight: 700 }}>
            Society Config
          </Link>
          .
        </div>
      )}
      {!moduleOff && !billingOn && (
        <div style={{ ...S.notice, marginTop: "1rem" }}>
          <b>Commercial billing is off.</b> Rates set here won&apos;t be used until you tick{" "}
          <b>Charge shops and offices differently</b> in{" "}
          <Link href="/admin/society-config" style={{ fontWeight: 700 }}>
            Society Config
          </Link>
          .
        </div>
      )}
      {msg && <div style={{ ...S.notice, marginTop: "1rem" }}>{msg}</div>}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{ ...S.btn, opacity: tab === t ? 1 : 0.5 }}
          >
            {t}
          </button>
        ))}
      </div>

      {gstWarn && (
        <div style={{ ...S.notice, marginTop: "0.75rem", background: "#fef3c7" }}>
          ⚠ GST may apply — this {tab.toLowerCase()}&apos;s monthly total exceeds ₹
          {GST_WARN_THRESHOLD.toLocaleString("en-IN")}. No tax line is added automatically; add a
          GST head manually if this society is GST-registered.
        </div>
      )}

      <div style={{ ...S.card, ...S.scroll, marginTop: "1rem" }}>
        <table style={{ ...S.table, minWidth: 760 }}>
          <thead>
            <tr>
              <th style={S.th}>Billing head</th>
              <th style={S.th}>Type</th>
              <th style={S.th}>{tab} rate</th>
              <th style={S.th}>Service charge?</th>
              <th style={S.th}>Non-occ eligible?</th>
              <th style={S.th}>Active</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td style={S.td} colSpan={6}>
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && heads.length === 0 && (
              <tr>
                <td style={S.td} colSpan={6}>
                  No {tab.toLowerCase()} billing heads yet — add one below.
                </td>
              </tr>
            )}
            {heads.map((h) => (
              <tr key={h.id} style={h.isActive === false ? { opacity: 0.5 } : undefined}>
                <td style={{ ...S.td, fontWeight: 600 }}>{h.headName}</td>
                <td style={{ ...S.td, color: "#64748b", fontSize: "0.78rem" }}>{h.calculationType}</td>
                <td style={S.td}>
                  <input
                    style={{ ...S.input, width: 100 }}
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={h.rate?.[tab] ?? ""}
                    onBlur={(e) =>
                      update.mutate({
                        id: h.id,
                        patch: { rate: { ...h.rate, [tab]: Number(e.target.value) || 0 } },
                      })
                    }
                  />
                </td>
                <td style={S.td}>
                  <input
                    type="checkbox"
                    checked={h.isServiceCharge}
                    onChange={(e) => update.mutate({ id: h.id, patch: { isServiceCharge: e.target.checked } })}
                  />
                </td>
                <td style={S.td}>
                  <input
                    type="checkbox"
                    checked={h.nonOccupancyEligible}
                    onChange={(e) =>
                      update.mutate({ id: h.id, patch: { nonOccupancyEligible: e.target.checked } })
                    }
                  />
                </td>
                <td style={S.td}>
                  <input
                    type="checkbox"
                    checked={h.isActive}
                    onChange={(e) => update.mutate({ id: h.id, patch: { isActive: e.target.checked } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>+ Add commercial-only head</div>
        <div style={S.row}>
          <input
            style={S.input}
            placeholder="Head name"
            value={newHead.headName}
            onChange={(e) => setNewHead({ ...newHead, headName: e.target.value })}
          />
          <select
            style={S.input}
            value={newHead.calculationType}
            onChange={(e) => setNewHead({ ...newHead, calculationType: e.target.value })}
          >
            <option value="Fixed">Fixed</option>
            <option value="Per Sq Ft">Per Sq Ft</option>
            <option value="Percentage">Percentage</option>
          </select>
          <input
            style={{ ...S.input, width: 120 }}
            type="number"
            min="0"
            placeholder={`${tab} rate`}
            value={newHead.rate}
            onChange={(e) => setNewHead({ ...newHead, rate: e.target.value })}
          />
          <button
            type="button"
            style={S.btn}
            disabled={create.isPending || newHead.headName.trim().length < 2}
            onClick={() =>
              create.mutate({
                headName: newHead.headName.trim(),
                categoryScope: [tab],
                calculationType: newHead.calculationType,
                rate: { [tab]: Number(newHead.rate) || 0 },
              })
            }
          >
            {create.isPending ? "Adding…" : `Add to ${tab}`}
          </button>
        </div>
      </div>

      <div style={S.card}>
        <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>
          What one {tab.toLowerCase()} would be charged
        </div>
        <div style={S.row}>
          <span style={{ fontSize: "0.82rem", color: "#475569" }}>Area (sq ft)</span>
          <input
            style={{ ...S.input, width: 110 }}
            type="number"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
          <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>
            {monthlyTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: "0.6rem" }}>
          Non-occupancy charge (rented-out units) is set per unit on the business profile, not here — it is
          always capped at 10% of that unit&apos;s service-charge heads.
        </div>
      </div>
    </div>
  );
}
