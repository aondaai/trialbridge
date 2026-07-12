/**
 * Archetype B resolver — database capability / metadata (spec §6, resolver 4b).
 *
 * Deterministic lookup over the CapabilityCatalog, keyed by canonical concept (the
 * classifier's output, resolved via the concept ladder). Returns a `Metric` sealed
 * SITE_DECLARED whose value is the availability (yes|no|partial) and whose confidence
 * is derived from the catalog's completeness rating. Method + source field ride along
 * in the note. A concept with no catalog row degrades to an `unavailable` Metric —
 * "concept unmapped", never a guessed "yes".
 *
 * Pure: catalog row in → Metric out. The Prisma binding lives in ./prisma.ts.
 */

import { Confidence, Provenance, siteDeclared, unavailable, type Metric } from "@/lib/metric";

/** The subset of CapabilityCatalog the resolver reads (matches the Prisma model). */
export interface CapabilityLike {
  conceptId: string;
  /** yes | no | partial */
  available: string;
  identificationMethod: string;
  sourceField: string;
  completenessValue: number | null;
  /** high | moderate | low */
  completenessQual: string;
  notes: string;
}

/** Completeness rating → Metric confidence. */
function confidenceFromCompleteness(qual: string): Confidence {
  switch (qual.toLowerCase()) {
    case "high":
      return Confidence.HIGH;
    case "low":
      return Confidence.LOW;
    default:
      return Confidence.MEDIUM;
  }
}

/**
 * Resolve a capability row to a Metric. `asOf` is injected (the row's lastValidatedAt)
 * so the resolver stays clock-free. A `null`/absent row → `unavailable` (concept not in
 * the catalog); the resolver never invents availability.
 */
export function resolveCapability(
  concept: string,
  row: CapabilityLike | null | undefined,
  asOf?: string | null,
): Metric<string | null> {
  const key = `capability.${concept}`;
  if (!row) {
    return unavailable(key, Provenance.SITE_DECLARED, `concept "${concept}" not in capability catalog`, {
      asOf: asOf ?? null,
    });
  }
  const noteBits = [
    row.identificationMethod && `method: ${row.identificationMethod}`,
    row.sourceField && `source: ${row.sourceField}`,
    row.notes && row.notes,
  ].filter(Boolean);
  return siteDeclared(key, row.available || "partial", confidenceFromCompleteness(row.completenessQual), {
    asOf: asOf ?? null,
    note: noteBits.join(" · ") || null,
    // Carry completeness as a single-point band so the DQ layer (F5) can read it.
    ci: row.completenessValue != null ? [row.completenessValue, row.completenessValue] : null,
  });
}

/** Is a resolved capability Metric a usable "yes/partial" (vs "no"/unavailable)? */
export function isCapable(m: Metric<string | null>): boolean {
  return m.value === "yes" || m.value === "partial";
}
