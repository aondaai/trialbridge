/**
 * Site infrastructure enrichment via the Parallel deep-web-search pipe (Part B / R9).
 *
 * The directory gives us site identity + CNES + capability flags, but not the equipment a
 * protocol actually requires — CACON/UNACON oncology accreditation, PET-CT, linear
 * accelerator, MRI, ICU beds, a GCP-grade pharmacy. Those live scattered across CNES
 * pages, hospital sites, and accreditation registries — a deep-web-research job with
 * citations. We research them with the Parallel Task API (`base`), precompute off the
 * request path (like KOL enrichment), and feed the result into the site scorecard's
 * infrastructure-fit component. Honest by construction: researched confidence + citations
 * ride along; when unavailable the site keeps its directory capability-flag proxy.
 */

import { Confidence, SourceRef, rollUpConfidence } from "@/lib/metric";
import { deepSearchMany } from "@/lib/parallel/deepSearch";
import { parallelEnabled, TaskResult, ParallelConfidence, Processor } from "@/lib/parallel/client";

/** The equipment/accreditation fields we research per site. */
export const SITE_INFRA_SCHEMA = {
  type: "object",
  properties: {
    cacon_or_unacon: { type: "boolean", description: "Is this an accredited oncology centre (CACON or UNACON habilitação)?" },
    pet_ct: { type: "boolean", description: "Does the site have a PET-CT scanner on site?" },
    linear_accelerator: { type: "boolean", description: "Does the site have a linear accelerator (radiotherapy)?" },
    mri: { type: "boolean", description: "Does the site have MRI on site?" },
    icu_beds: { type: "integer", description: "Approximate number of adult ICU beds (0 if none/unknown)." },
    gcp_pharmacy: { type: "boolean", description: "Does the site have an investigational-drug pharmacy suitable for GCP trials (temperature-controlled storage)?" },
  },
  required: ["cacon_or_unacon", "pet_ct", "linear_accelerator", "mri", "icu_beds", "gcp_pharmacy"],
} as const;

export interface SiteInfra {
  caconOrUnacon: boolean;
  petCt: boolean;
  linearAccelerator: boolean;
  mri: boolean;
  icuBeds: number;
  gcpPharmacy: boolean;
}

export interface SiteInfraEnrichment extends SiteInfra {
  cnes: string;
  source: "parallel" | "unavailable";
  confidence: Confidence;
  citations: SourceRef[];
}

export interface InfraSubject {
  cnes: string;
  name: string;
  city?: string | null;
  uf?: string | null;
}

export function infraInput(s: InfraSubject): string {
  const loc = [s.city, s.uf].filter(Boolean).join(", ");
  return `The Brazilian clinical research/hospital site "${s.name}"${loc ? ` in ${loc}` : ""} (CNES ${s.cnes}). Research its oncology infrastructure: CACON/UNACON accreditation, PET-CT, linear accelerator, MRI, adult ICU bed count, and GCP-grade investigational pharmacy.`;
}

const CONF_MAP: Record<ParallelConfidence, Confidence> = {
  high: Confidence.HIGH,
  medium: Confidence.MEDIUM,
  low: Confidence.LOW,
};

/** Pure: turn a Task API result into a site-infra enrichment. */
export function parseInfra(cnes: string, result: TaskResult): SiteInfraEnrichment {
  const empty: SiteInfraEnrichment = {
    cnes, source: "unavailable", caconOrUnacon: false, petCt: false, linearAccelerator: false,
    mri: false, icuBeds: 0, gcpPharmacy: false, confidence: Confidence.LOW, citations: [],
  };
  if (result.status !== "completed" || !result.content) return empty;
  const c = result.content;
  const icu = Number(c.icu_beds);
  const citations: SourceRef[] = result.basis
    .flatMap((b) => b.citations)
    .filter((x) => x.url)
    .map((x) => ({ label: x.title || hostOf(x.url!) || "web source", url: x.url ?? null }));
  const confidences = result.basis.map((b) => (b.confidence ? CONF_MAP[b.confidence] : Confidence.LOW));
  return {
    cnes,
    source: "parallel",
    caconOrUnacon: Boolean(c.cacon_or_unacon),
    petCt: Boolean(c.pet_ct),
    linearAccelerator: Boolean(c.linear_accelerator),
    mri: Boolean(c.mri),
    icuBeds: Number.isFinite(icu) && icu >= 0 ? Math.round(icu) : 0,
    gcpPharmacy: Boolean(c.gcp_pharmacy),
    confidence: rollUpConfidence(confidences),
    citations: dedupe(citations),
  };
}

/** Count of the six binary infra items present (for an infra-fit proxy). */
export function infraPresentCount(i: SiteInfra): number {
  return [i.caconOrUnacon, i.petCt, i.linearAccelerator, i.mri, i.icuBeds > 0, i.gcpPharmacy].filter(Boolean).length;
}

/** The parallel pipe: research many sites concurrently. No-op when the key is absent. */
export async function enrichSites(
  subjects: InfraSubject[],
  opts: { concurrency?: number; processor?: Processor } = {},
): Promise<Map<string, SiteInfraEnrichment>> {
  if (!parallelEnabled() || subjects.length === 0) return new Map();
  const results = await deepSearchMany(subjects.map(infraInput), SITE_INFRA_SCHEMA, {
    processor: opts.processor ?? "base",
    concurrency: opts.concurrency ?? 4,
    pollMs: 3000,
    maxPolls: 30,
  });
  const map = new Map<string, SiteInfraEnrichment>();
  subjects.forEach((s, i) => map.set(s.cnes, parseInfra(s.cnes, results[i])));
  return map;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
function dedupe(cits: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const c of cits) {
    const key = c.url ?? c.label;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 8);
}
