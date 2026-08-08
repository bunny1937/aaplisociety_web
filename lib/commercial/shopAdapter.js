// lib/commercial/shopAdapter.js
//
// NEW 2026-08-07.
//
// The commercial charge engine used to take a Member and read `flatType` to
// decide whether it was a Shop, an Office, or a flat. That is exactly the
// design that destroyed A-103: one field could not say "this is a flat AND
// there is a shop here".
//
// A shop is now its own record (models/Shop.js). This adapter is the ONE place
// that turns either record into the small, boring shape the engine needs, so
// the engine never has to know which kind of thing it was handed.
//
// Nothing here reads a Member's residential fields when given a Shop. That is
// the whole point: a shop's area, its dues and its class are its own.

import { UNIT_CLASSES } from "./constants";
import { billableArea } from "./areaResolver";

/** A Shop doc is recognised by its own area field + unit kind. */
export function isShopRecord(rec) {
  return !!rec && (rec.unitKind === "Shop" || rec.unitKind === "Office");
}

/**
 * Normalise a Shop OR a Member into what billing actually needs.
 *
 * @returns {{
 *   kind: "shop" | "member",
 *   id: string,
 *   unitClass: "Shop" | "Office" | "Residential",
 *   area: number,
 *   areaLabel: string,
 *   label: string,
 *   ownerName: string | null,
 *   occupancyType: string | null,
 *   isRentedOut: boolean,
 *   openingPrincipal: number,
 *   openingInterest: number,
 *   memberId: string | null,
 * }}
 */
export function toBillableUnit(rec) {
  if (isShopRecord(rec)) {
    const area = Number(rec.areaSqft) || 0;
    return {
      kind: "shop",
      id: String(rec._id ?? rec.id ?? ""),
      unitClass: rec.unitKind,
      area,
      // A shop keeps ONE agreed area. `areaBasisNote` is a record of what that
      // figure represents; it never changes the arithmetic.
      areaLabel: area > 0 ? `${area} sq ft (${rec.areaBasisNote || "Carpet"})` : "Area not set",
      label: [rec.wing, rec.shopNo].filter(Boolean).join("-") || "Shop",
      ownerName: rec.ownerName ?? null,
      occupancyType: rec.occupancyType ?? null,
      isRentedOut: rec.occupancyType === "Rented out",
      // A shop's dues are its own. This is what stops a commercial bill
      // inheriting a flat's residential opening balance, which is how A-103
      // ended up carrying Rs 1,335 it never owed on that series.
      openingPrincipal: Number(rec.openingPrincipal) || 0,
      openingInterest: Number(rec.openingInterest) || 0,
      memberId: rec.ownerMemberId ? String(rec.ownerMemberId) : null,
    };
  }

  // A Member is always residential now. `flatType` is no longer written by the
  // commercial module at all, so "Shop" can only appear on legacy rows.
  const area = billableArea(rec);
  return {
    kind: "member",
    id: String(rec?._id ?? rec?.id ?? ""),
    unitClass: UNIT_CLASSES.RESIDENTIAL,
    area,
    areaLabel: area > 0 ? `${area} sq ft` : "Area not set",
    label: [rec?.wing, rec?.flatNo ?? rec?.roomNo].filter(Boolean).join("-") || "Unit",
    ownerName: rec?.ownerName ?? null,
    occupancyType: rec?.ownershipType ?? null,
    isRentedOut: rec?.ownershipType === "Rented out",
    openingPrincipal: Number(rec?.openingPrincipal) || 0,
    openingInterest: Number(rec?.openingInterest) || 0,
    memberId: String(rec?._id ?? ""),
  };
}
