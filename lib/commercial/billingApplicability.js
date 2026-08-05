// Optional commercial billing applicability.
//
// COMPATIBILITY CONTRACT: a BillingHead with no `appliesToUnitClasses` (every
// existing document) applies to EVERY unit, exactly as today. Only a head that
// an admin explicitly restricts is filtered. There is no migration and no
// change to Bill / Transaction / Receipt / Ledger V2 / accounting.
import { unitClassForMember } from "./constants";

export function headAppliesToUnitClass(head, unitClass) {
  const list = head?.appliesToUnitClasses;
  if (!Array.isArray(list) || list.length === 0) return true; // legacy = all
  return list.includes(unitClass);
}

export function filterHeadsForMember(heads, member) {
  if (!Array.isArray(heads)) return [];
  const unitClass = unitClassForMember(member);
  return heads.filter((head) => headAppliesToUnitClass(head, unitClass));
}

// Snapshot written into bill generation metadata so a bill can always be
// explained after the fact.
export function applicabilitySnapshot(heads, member) {
  const unitClass = unitClassForMember(member);
  const restricted = (heads || []).filter(
    (h) => Array.isArray(h?.appliesToUnitClasses) && h.appliesToUnitClasses.length > 0,
  );
  return {
    unitClass,
    restrictedHeadCount: restricted.length,
    appliedHeadCount: filterHeadsForMember(heads, member).length,
  };
}

// ---------------------------------------------------------------------------
// Per-unit-class rate overrides.
//
// `appliesToUnitClasses` answers "does this head apply at all?".
// `unitClassRates` answers "how much does THIS class pay?" - which is the
// normal case for commercial units: a shop pays maintenance too, just at a
// different rate. A head with no override returns `defaultAmount`, so every
// head that exists today resolves to exactly the amount it resolves to now.
// ---------------------------------------------------------------------------

export function resolveHeadRate(head, unitClass) {
  const rates = head?.unitClassRates;
  const raw =
    rates && typeof rates === "object" ? rates[unitClass] : undefined;
  if (raw === undefined || raw === null || raw === "") {
    return Number(head?.defaultAmount) || 0;
  }
  const override = Number(raw);
  return Number.isFinite(override) && override >= 0
    ? override
    : Number(head?.defaultAmount) || 0;
}

// Returns the heads that apply to this member, with `defaultAmount` already
// resolved to that member's unit class. Callers keep using `defaultAmount` and
// need no other change.
export function resolveHeadsForMember(heads, member) {
  if (!Array.isArray(heads)) return [];
  const unitClass = unitClassForMember(member);
  return filterHeadsForMember(heads, member).map((head) => {
    const rate = resolveHeadRate(head, unitClass);
    if ((Number(head?.defaultAmount) || 0) === rate) return head;
    const base = typeof head?.toObject === "function" ? head.toObject() : head;
    return { ...base, defaultAmount: rate };
  });
}

// True when a head charges at least one class differently from another.
export function hasRateOverrides(head) {
  const r = head?.unitClassRates;
  if (!r || typeof r !== "object") return false;
  return ["Residential", "Shop", "Office"].some(
    (k) => r[k] !== undefined && r[k] !== null && r[k] !== "",
  );
}

// Accepts whatever the client sent and returns a clean { Shop: 1200, ... }
// object, or undefined when nothing usable was supplied (= no override at all).
// Throws nothing: invalid entries are dropped, so a bad payload can never make
// a head charge a wrong amount silently.
export function normalizeUnitClassRates(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out = {};
  for (const key of ["Residential", "Shop", "Office"]) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) continue;
    out[key] = num;
  }
  return Object.keys(out).length ? out : undefined;
}
