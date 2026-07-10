/**
 * Pure helpers for the site-onboarding form (`/site/new`). Kept dependency-free
 * (no Prisma, no "use server") so they're unit-testable without a DB — see
 * tests/site-onboarding.test.ts. The server action in ./actions.ts is a thin
 * wrapper around these plus the two `@/lib/data/sites` DB calls.
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
 * Parse + validate the pasted `patientsJson` field. Accepts either a bare JSON
 * array of patients, or an object with a `patients` array — the shape of the
 * generated `data/site-*.json` files. Throws a descriptive `Error` on any
 * invalid shape. Every returned patient has `siteId` overwritten to `siteId`
 * (same normalization `replacePatients` relies on), regardless of whatever
 * the pasted JSON carried.
 */
export function parsePatientsJson(raw: string, siteId: string): Patient[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Patient records field is not valid JSON.");
  }

  let candidates: unknown;
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { patients?: unknown }).patients)
  ) {
    candidates = (parsed as { patients: unknown }).patients;
  } else {
    throw new Error(
      "Patient records must be a JSON array of patients, or an object with a \"patients\" array (the shape of a generated data/site-*.json file).",
    );
  }

  const list = candidates as unknown[];
  if (list.length === 0) {
    throw new Error("Patient records must contain at least one patient.");
  }

  list.forEach((el, i) => {
    if (
      !el ||
      typeof el !== "object" ||
      typeof (el as { id?: unknown }).id !== "string" ||
      (el as { id: string }).id.trim() === ""
    ) {
      throw new Error(`Patient at index ${i} is missing a string "id".`);
    }
  });

  return list.map((el) => ({ ...(el as Record<string, unknown>), siteId }) as Patient);
}
