/**
 * Pure helpers for the site-onboarding form (`/site/new`). Kept dependency-free
 * (no Prisma, no "use server") so they're unit-testable without a DB — see
 * tests/site-onboarding.test.ts. The server action in ./actions.ts is a thin
 * wrapper around this plus the two `@/lib/data/sites` DB calls.
 */

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
