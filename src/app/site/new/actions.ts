"use server";

/**
 * "A site lists itself" — the missing entry point into the counts-not-rows
 * boundary (`upsertSite`/`replacePatients` in @/lib/data/sites previously had
 * no callers; the app starts with an empty DB by design). Validation + the
 * derived site id come from the pure helpers in ./parse.ts so they're
 * unit-testable without a DB.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { upsertSite, replacePatients, type SiteMeta } from "@/lib/data/sites";
import { slugify, parsePatientsJson } from "./parse";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;

export async function listSite(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const region = String(formData.get("region") ?? "").trim();
  const monthlyIncidenceRaw = String(formData.get("monthlyIncidence") ?? "").trim();
  const patientsJson = String(formData.get("patientsJson") ?? "");

  if (!name) throw new Error("Site name is required.");
  if (!city) throw new Error("City is required.");
  if (!(REGIONS as readonly string[]).includes(region)) {
    throw new Error(`Region must be one of: ${REGIONS.join(", ")}.`);
  }
  if (!/^\d+$/.test(monthlyIncidenceRaw)) {
    throw new Error("Monthly incidence must be a whole number ≥ 0.");
  }
  if (!patientsJson.trim()) {
    throw new Error("Patient records (JSON) is required.");
  }

  const id = slugify(name);
  if (!id) {
    throw new Error("Site name must contain at least one letter or number.");
  }

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

  const patients = parsePatientsJson(patientsJson, id);

  await upsertSite(meta);
  await replacePatients(id, patients);

  revalidatePath("/site");
  redirect(`/site?site=${id}`);
}
