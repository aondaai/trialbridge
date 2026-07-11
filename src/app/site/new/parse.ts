/**
 * Pure helpers for the site-onboarding form (`/site/new`). Kept dependency-free
 * (no Prisma, no "use server") so they're unit-testable without a DB — see
 * tests/site-onboarding.test.ts. The server action in ./actions.ts is a thin
 * wrapper around this plus the two `@/lib/data/sites` DB calls.
 */

import type { Patient } from "@/lib/matcher/types";

/**
 * Derive a stable site id from a display name: lowercase, diacritics stripped,
 * non-alphanumeric runs collapsed to a single hyphen, leading/trailing hyphens
 * trimmed. e.g. "Clínica Norte Câncer" -> "clinica-norte-cancer".
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritic marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `replacePatients` (src/lib/data/sites.ts) keys DB rows `${siteId}:${p.id}`.
 * A CSV with a repeated MRN — or a source id that happens to collide with a
 * generated `row-N` placeholder — would otherwise produce duplicate keys and
 * blow up the `$transaction` with a unique-constraint error. Per spec:
 * "Duplicate/blank id → generate a stable synthetic id; never drop a row
 * silently." Blank ids are filled in first (by row position), then any id
 * that duplicates an id already claimed (case-sensitive, in array order) is
 * suffixed with `-2`, `-3`, … until it's unique. Only `id` is touched.
 */
export function ensureUniquePatientIds(patients: Patient[]): Patient[] {
  const withFilledIds = patients.map((p, i) => ({
    ...p,
    id: p.id || `row-${i + 1}`,
  }));

  const seen = new Set<string>();
  return withFilledIds.map((p) => {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      return p;
    }
    let n = 2;
    let candidate = `${p.id}-${n}`;
    while (seen.has(candidate)) {
      n++;
      candidate = `${p.id}-${n}`;
    }
    seen.add(candidate);
    return { ...p, id: candidate };
  });
}
