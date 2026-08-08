"use client";
// app/admin/generate-bills/TestConfigPanel.jsx
//
// Residential-only test/admin helper for editing a member's carpet area and
// parking slots inline. Parking slots don't exist for commercial units, so
// this only ever renders for the residential segment. Lifted verbatim out of
// page.js — same state, same handlers, same markup, just relocated.
import { useState } from "react";

const SLOT_TYPES = ["Open", "Covered", "Stilt"];
const VEHICLE_TYPES = ["Two-Wheeler", "Four-Wheeler"];
export default function TestConfigPanel({ members, periodLabel, onSaved }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [carpetArea, setCarpetArea] = useState("");
  const [slots, setSlots] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [applyTo, setApplyTo] = useState("next"); // "next" | "current"
  const activeMem = (members || []).filter((m) => !m.isDeleted);
  function loadMember(id) {
    setSelectedId(id);
    setMsg("");
    const m = activeMem.find((x) => x._id === id);
    if (!m) return;
    setCarpetArea(String(m.carpetAreaSqft ?? ""));
    setSlots(
      (m.parkingSlots || []).map((s) => ({
        slotNumber: s.slotNumber || "",
        type: s.type || "Open",
        vehicleType: s.vehicleType || "Two-Wheeler",
        monthlyBilling: s.monthlyBilling !== false,
      })),
    );
  }
  function addSlot() {
    setSlots((prev) => [
      ...prev,
      {
        slotNumber: "",
        type: "Open",
        vehicleType: "Two-Wheeler",
        monthlyBilling: true,
      },
    ]);
  }
  function removeSlot(i) {
    setSlots((prev) => prev.filter((_, idx) => idx !== i));
  }
  function patchSlot(i, key, val) {
    setSlots((prev) =>
      prev.map((s, idx) => {
        if (idx !== i) return s;
        const updated = { ...s, [key]: val };
        if (key === "type") updated.monthlyBilling = val !== "Stilt";
        return updated;
      }),
    );
  }
  async function save() {
    if (!selectedId) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/members/quick-patch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          memberId: selectedId,
          carpetAreaSqft: carpetArea !== "" ? Number(carpetArea) : undefined,
          parkingSlots: slots,
          recalcBillPeriodId: applyTo === "current" && periodLabel ? periodLabel : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const recalcNote = data.billRecalculated ? ` · Bill ${periodLabel} updated` : "";
      setMsg(`✅ Saved: ${data.member.wing}-${data.member.flatNo}${recalcNote}`);
      onSaved?.();
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      style={{
        background: "#fffbeb",
        border: "2px dashed #f59e0b",
        borderRadius: "12px",
        marginBottom: "1.5rem",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "0.75rem 1.25rem",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.9rem",
          fontWeight: 600,
          color: "#92400e",
        }}
      >
        <span>{open ? "▼" : "▶"}</span>
        🧪 Test Config Panel — edit member parking &amp; carpet area instantly
      </button>
      {open && (
        <div
          style={{ padding: "1rem 1.25rem", borderTop: "1px dashed #f59e0b" }}
        >
          <div
            style={{
              display: "flex",
              gap: "1rem",
              alignItems: "flex-end",
              flexWrap: "wrap",
              marginBottom: "1rem",
            }}
          >
            <div>
              <label
                style={{
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Member
              </label>
              <select
                value={selectedId}
                onChange={(e) => loadMember(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #d97706",
                  minWidth: 180,
                }}
              >
                <option value="">-- select --</option>
                {activeMem.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.wing}-{m.flatNo} {m.ownerName}
                  </option>
                ))}
              </select>
            </div>
            {selectedId && (
              <div>
                <label
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Carpet Area (sqft)
                </label>
                <input
                  type="number"
                  value={carpetArea}
                  onChange={(e) => setCarpetArea(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #d97706",
                    width: 120,
                  }}
                />
              </div>
            )}
          </div>
          {selectedId && (
            <>
              <div
                style={{
                  marginBottom: "0.5rem",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  color: "#78350f",
                }}
              >
                Parking Slots
              </div>
              {slots.length === 0 && (
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "#92400e",
                    marginBottom: "0.5rem",
                  }}
                >
                  No slots
                </div>
              )}
              {slots.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                    marginBottom: "0.4rem",
                    flexWrap: "wrap",
                    background: "#fef3c7",
                    padding: "0.4rem 0.6rem",
                    borderRadius: 6,
                  }}
                >
                  <input
                    placeholder="Slot#"
                    value={s.slotNumber}
                    onChange={(e) => patchSlot(i, "slotNumber", e.target.value)}
                    style={{
                      width: 70,
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid #d97706",
                    }}
                  />
                  <select
                    value={s.type}
                    onChange={(e) => patchSlot(i, "type", e.target.value)}
                    style={{
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid #d97706",
                    }}
                  >
                    {SLOT_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={s.vehicleType}
                    onChange={(e) =>
                      patchSlot(i, "vehicleType", e.target.value)
                    }
                    style={{
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid #d97706",
                    }}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <label
                    style={{
                      fontSize: "0.78rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={s.monthlyBilling}
                      onChange={(e) =>
                        patchSlot(i, "monthlyBilling", e.target.checked)
                      }
                    />
                    Bill monthly
                  </label>
                  <button
                    onClick={() => removeSlot(i)}
                    style={{
                      background: "#ef4444",
                      color: "#fff",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 8px",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                  alignItems: "center",
                }}
              >
                <button
                  onClick={addSlot}
                  style={{
                    background: "#f59e0b",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 14px",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                  }}
                >
                  + Add Slot
                </button>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, fontSize: "0.8rem", color: "#92400e" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="radio" name="applyTo" value="next" checked={applyTo === "next"} onChange={() => setApplyTo("next")} />
                      Apply from next month
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="radio" name="applyTo" value="current" checked={applyTo === "current"} onChange={() => setApplyTo("current")} />
                      Apply to current month ({periodLabel || "…"})
                    </label>
                  </div>
                  <button
                    onClick={save}
                    disabled={saving}
                    style={{
                      background: "#059669",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 18px",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    {saving ? "Saving…" : "💾 Save"}
                  </button>
                </div>
                {msg && (
                  <span
                    style={{
                      fontSize: "0.85rem",
                      color: msg.startsWith("✅") ? "#065f46" : "#991b1b",
                    }}
                  >
                    {msg}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}