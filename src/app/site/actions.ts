"use server";

/**
 * Live "submit proof of capacity" action for Camila's site.
 *
 * Computes the site's tri-state counts + bottleneck with the deterministic
 * matcher and writes a counts-not-rows Response. This is the one live-write step
 * in the demo that closes the two-sided loop (sites B & C are pre-seeded).
 */

import { revalidatePath } from "next/cache";
import { loadSite } from "@/lib/data/sites";
import { deleteResponse, getConsultation, upsertResponse, StoredResponse } from "@/lib/store";
import { evaluateCohort, countCohorts } from "@/lib/matcher/engine";
import { rankBottlenecks } from "@/lib/matcher/soften";

export async function submitCapacity(formData: FormData) {
  const consultationId = String(formData.get("consultationId"));
  const siteId = String(formData.get("siteId"));

  const consultation = await getConsultation(consultationId);
  if (!consultation) throw new Error(`Unknown consultation ${consultationId}`);
  const ds = await loadSite(siteId);
  if (!ds) throw new Error(`Unknown site ${siteId}`);

  const evals = evaluateCohort(ds.patients, consultation.criteria);
  const counts = countCohorts(evals);
  const top = rankBottlenecks(ds.patients, consultation.criteria)[0];

  const resp: StoredResponse = {
    id: `resp-${consultationId}-${siteId}`,
    consultationId,
    siteId,
    siteName: ds.site.name,
    definite: counts.definite,
    possible: counts.possible,
    excluded: counts.excluded,
    total: counts.total,
    bottleneckHandle: top?.handle ?? null,
    bottleneckLabel: top?.label ?? null,
    monthlyIncidence: ds.site.monthlyIncidence,
    live: true,
    submittedAt: new Date().toISOString(),
  };
  await upsertResponse(resp);

  revalidatePath("/site");
  revalidatePath("/site/respond");
  revalidatePath("/sponsor");
}

export async function withdrawCapacity(formData: FormData) {
  // Reset to the seeded state so the demo can be re-run cleanly.
  const consultationId = String(formData.get("consultationId"));
  const siteId = String(formData.get("siteId"));
  await deleteResponse(consultationId, siteId);
  revalidatePath("/site");
  revalidatePath("/site/respond");
  revalidatePath("/sponsor");
}
