// lib/commercial/areaResolver.js
//
// NEW 2026-08-07 — one place that decides what area a unit is billed on.
//
// WHY THIS FILE EXISTS
//
// A Member can carry three different area numbers:
//
//   carpetAreaSqft    the real, current figure (models/Member.js:91, required)
//   builtUpAreaSqft   optional
//   areaSqFt          LEGACY, written only by the old Excel importer
//                     (lib/excel-handler.js:194)
//
// Different files picked a different one, and two of them picked in the
// OPPOSITE order:
//
//   lib/commercial/commercialChargeEngine.js   carpet -> builtUp -> legacy
//   lib/calculate-member-bill.js               carpet -> builtUp -> legacy
//   app/api/bill-template/preview-bill/route.js  LEGACY -> carpet -> builtUp
//   lib/bill-renderer.js                       carpet only
//
// So the area a bill was CALCULATED on and the area PRINTED on that same bill
// were resolved by different rules. That is how A-103 showed "400 sq.ft" on its
// flat profile, "560 sq ft" on the bill header, and was charged on 560
// (Maintainance 1120 / Rs 2 per sq ft = 560; residential 840 / 1.5 = 560) —
// three numbers, one flat, no error anywhere.
//
// Every caller now uses resolveArea(). It returns the number AND which field it
// came from, so the bill can print "Carpet area 400 sq ft" instead of a bare
// figure nobody can trace, and so a disagreement between the fields becomes a
// visible warning instead of a silent choice.

export const AREA_FIELDS = [
  { key: "carpetAreaSqft", label: "Carpet area", legacy: false },
  { key: "builtUpAreaSqft", label: "Built-up area", legacy: false },
  { key: "areaSqFt", label: "Imported area", legacy: true },
];

const pos = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Resolve the billable area for a member/unit.
 *
 * Order is deliberate and is now the same everywhere:
 *   1. carpetAreaSqft  — what the society measured and what bye-laws bill on
 *   2. builtUpAreaSqft — only if no carpet area was ever recorded
 *   3. areaSqFt        — legacy import value, last resort only
 *
 * @returns {{
 *   area: number,
 *   basis: string|null,      // field key actually used
 *   basisLabel: string|null, // human label for the bill
 *   isLegacy: boolean,       // true if we fell back to the imported value
 *   present: Array<{key,label,value,legacy}>,
 *   conflict: null | { billed: number, alsoOnFile: Array<{label,value}> },
 * }}
 */
export function resolveArea(member, opts = {}) {
  // Q3 — the society picks carpet or built-up once, in Society settings, and
  // every residential bill follows it live. Passing no basis keeps the old
  // carpet-first order, so nothing changes for callers that have not been
  // updated.
  const basisPref = opts.areaBasis === "builtup" ? "builtUpAreaSqft" : null;
  const present = AREA_FIELDS.map((f) => ({
    ...f,
    value: pos(member?.[f.key]),
  })).filter((f) => f.value > 0);

  // If the society bills on built-up and this unit has one, it wins. If the
  // unit has no built-up figure we fall back rather than bill Rs 0.
  const preferred = basisPref ? present.find((f) => f.key === basisPref) : null;
  const chosen = preferred ?? present[0] ?? null;
  const area = chosen?.value ?? 0;

  // Other non-zero area fields that disagree with the one we billed on. This is
  // not an error — carpet and built-up are legitimately different numbers — but
  // the admin should be told which one the money is based on.
  const others = present.filter((f) => f.key !== chosen?.key && f.value !== area);

  const legacy = present.find((f) => f.legacy && f.value !== area) ?? null;

  return {
    area,
    basis: chosen?.key ?? null,
    basisLabel: chosen?.label ?? null,
    isLegacy: chosen?.legacy === true,
    // true when the society asked for built-up but this unit has none
    fellBackFromBasis: !!basisPref && chosen?.key !== basisPref,
    requestedBasis: basisPref,
    present,
    conflict: others.length
      ? {
          billed: area,
          alsoOnFile: others.map((f) => ({ label: f.label, value: f.value })),
          // FIX: areaWarnings() below reads legacyValue. It was never set, so
          // the warning printed "An old imported area (undefined sq ft)".
          legacyValue: legacy ? legacy.value : null,
        }
      : null,
  };
}

/** Plain number, for call sites that only need the figure. */
export function billableArea(member, opts = {}) {
  return resolveArea(member, opts).area;
}

/** "Carpet area 400 sq ft" — for bill headers and preview lines. */
export function areaBasisLabel(member, opts = {}) {
  const r = resolveArea(member, opts);
  if (!r.area) return "Area not set";
  return `${r.basisLabel} ${r.area} sq ft`;
}

/**
 * Admin-facing warnings about a unit's area. Returned by the Units screen so a
 * problem is visible before bills are generated, not after they are disputed.
 */
export function areaWarnings(member, { isCommercial = false } = {}) {
  const r = resolveArea(member);
  const out = [];

  if (!r.area) {
    out.push({
      code: "AREA_MISSING",
      severity: isCommercial ? "error" : "warning",
      title: "No area recorded for this unit",
      detail:
        "Every 'per sq ft' charge multiplies by this number, so those charges will bill Rs 0.",
      fix: "Enter the carpet area from the sale agreement or the society's measurement sheet.",
    });
    return out;
  }

  if (r.isLegacy) {
    out.push({
      code: "AREA_LEGACY",
      severity: "warning",
      title: `Billing on an imported area of ${r.area} sq ft`,
      detail:
        "This figure came from the original Excel import, not from a carpet area entered in the app. It is used because no carpet area has been recorded.",
      fix: "Enter the correct carpet area to replace it.",
    });
  }

  if (r.fellBackFromBasis) {
    out.push({
      code: "AREA_BASIS_FALLBACK",
      severity: "warning",
      title: "This unit has no built-up area on file",
      detail:
        `Your society bills on built-up area, but this unit only has ${r.basisLabel?.toLowerCase()}. ` +
        `It is being billed on ${r.area} sq ft so that its charges are not Rs 0.`,
      fix: "Add the built-up area for this unit, or switch the society back to carpet area.",
      fixHref: "/admin/settings/society",
    });
  }

  if (r.conflict?.legacyValue) {
    out.push({
      code: "AREA_CONFLICT",
      severity: "warning",
      title: `An old imported area (${r.conflict.legacyValue} sq ft) disagrees with ${r.basisLabel.toLowerCase()} (${r.area} sq ft)`,
      detail:
        `Bills are calculated on ${r.area} sq ft. The ${r.conflict.legacyValue} sq ft figure came from the original ` +
        "spreadsheet import and is not shown on any screen, so it is easy to miss.",
      fix: "Confirm which figure is correct. If the imported one is right, set it as the area here.",
    });
  }

  return out;
}
