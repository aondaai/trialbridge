"use server";

/**
 * "A site lists itself" — the missing entry point into the counts-not-rows
 * boundary (`upsertSite`/`replacePatients` in @/lib/data/sites previously had
 * no callers; the app starts with an empty DB by design). The site fields are
 * validated here; the patient records themselves are no longer pasted JSON —
 * they arrive pre-verified from the EHR intake panel (Task 6's
 * POST /api/patient-intake) as a hidden `patients` field carrying the
 * confirmed `Patient[]` the user reviewed in the mapping/preview UI.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { upsertSite, replacePatients, type SiteMeta } from "@/lib/data/sites";
import { slugify } from "./parse";
import type { Patient } from "@/lib/matcher/types";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;

export async function listSite(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();
  const monthlyIncidenceRaw = String(formData.get("monthlyIncidence") ?? "").trim();
  const patientsRaw = String(formData.get("patients") ?? "");

  if (!name) throw new Error("Site name is required.");
  if (!city) throw new Error("City is required.");
  if (!(REGIONS as readonly string[]).includes(region)) {
    throw new Error(`Region must be one of: ${REGIONS.join(", ")}.`);
  }
  if (!/^\d+$/.test(monthlyIncidenceRaw)) {
    throw new Error("Monthly incidence must be a whole number ≥ 0.");
  }

  const id = slugify(name);
  if (!id) {
    throw new Error("Site name must contain at least one letter or number.");
  }

  let patients: Patient[];
  try {
    patients = JSON.parse(patientsRaw) as Patient[];
  } catch {
    throw new Error("Upload and verify your EHR export before listing the site.");
  }
  if (!Array.isArray(patients) || patients.length === 0) {
    throw new Error("No structured patient records — upload an EHR export first.");
  }
  patients = patients.map((p, i) => ({ ...p, id: p.id || `row-${i + 1}`, siteId: id }));

  const meta: SiteMeta = {
    id,
    name,
    country: "BR",
    city,
    region,
    // The demo personas ("Dra. Camila Rocha — ...") are seed-data flavor, not
    // something a real site fills in on onboarding.
    persona: "",
    monthlyIncidence: Number(monthlyIncidenceRaw),
  };

  await upsertSite(meta);
  await replacePatients(id, patients);

  revalidatePath("/site");
  redirect(`/site?site=${id}`);
}
