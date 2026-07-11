/**
 * KOL enrichment via the Parallel deep-web-search pipe.
 *
 * R8's KOL score wants publications, society roles, and guideline authorship — signals
 * no single registry API exposes. This module researches them from the open web (with
 * citations) via the Parallel Task API and merges them into a `KolSignals`, so a KOL's
 * score reflects real production, not just trial experience. Honest by construction:
 * the researched confidence + citations ride along, and when the pipe is unavailable
 * (no key / timeout) the investigator keeps its CT.gov trial-experience signal only.
 */

import { Confidence, SourceRef, rollUpConfidence } from "@/lib/metric";
import { deepSearchMany } from "@/lib/parallel/deepSearch";
import { parallelEnabled, TaskResult, ParallelConfidence } from "@/lib/parallel/client";
import type { KolInvestigatorInput, KolSignals } from "@/lib/kol/score";

/** JSON Schema the Task API fills for one physician. */
export const KOL_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    pubs_count_ta: {
      type: "integer",
      description:
        "Approximate number of peer-reviewed publications (PubMed/indexed) this physician has authored in the therapeutic area in roughly the last 10 years. 0 if none found.",
    },
    society_roles: {
      type: "array",
      items: { type: "string" },
      description:
        "Brazilian medical-society leadership or faculty roles held by this physician, as short codes/names (e.g. SBOC, SBCO, SBRT, SOBOPE, SBC). Empty array if none found.",
    },
    guideline_author: {
      type: "boolean",
      description: "Whether this physician has authored or co-authored a clinical practice guideline in the therapeutic area.",
    },
  },
  required: ["pubs_count_ta", "society_roles", "guideline_author"],
} as const;

export interface InvestigatorEnrichment {
  name: string;
  source: "parallel" | "unavailable";
  pubsCountTa: number;
  societyRoles: string[];
  guidelineAuthor: boolean;
  confidence: Confidence;
  citations: SourceRef[];
}

export interface EnrichSubject {
  name: string;
  affiliation?: string | null;
  therapeuticArea?: string | null;
}

/** Build the natural-language research input for one physician. */
export function enrichInput(s: EnrichSubject): string {
  const ta = s.therapeuticArea || "oncology";
  const aff = s.affiliation ? ` at ${s.affiliation}` : "";
  return `Dr. ${s.name}${aff}, a clinical trial investigator in ${ta} in Brazil. Research their scientific publication record, Brazilian medical-society roles, and clinical-guideline authorship.`;
}

const CONF_MAP: Record<ParallelConfidence, Confidence> = {
  high: Confidence.HIGH,
  medium: Confidence.MEDIUM,
  low: Confidence.LOW,
};

/** Pure: turn a Task API result into an enrichment for `name`. */
export function parseEnrichment(name: string, result: TaskResult): InvestigatorEnrichment {
  if (result.status !== "completed" || !result.content) {
    return { name, source: "unavailable", pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, confidence: Confidence.LOW, citations: [] };
  }
  const c = result.content;
  const pubs = Number(c.pubs_count_ta);
  const roles = Array.isArray(c.society_roles) ? c.society_roles.map(String).filter(Boolean) : [];
  const citations: SourceRef[] = result.basis
    .flatMap((b) => b.citations)
    .filter((x) => x.url)
    .map((x) => ({ label: x.title || hostOf(x.url!) || "web source", url: x.url ?? null }));
  const confidences = result.basis.map((b) => (b.confidence ? CONF_MAP[b.confidence] : Confidence.LOW));
  return {
    name,
    source: "parallel",
    pubsCountTa: Number.isFinite(pubs) && pubs >= 0 ? Math.round(pubs) : 0,
    societyRoles: roles,
    guidelineAuthor: Boolean(c.guideline_author),
    confidence: rollUpConfidence(confidences),
    citations: dedupeCitations(citations),
  };
}

/**
 * The parallel pipe: research many investigators concurrently, returning a map by
 * name. No-op (empty map) when the Parallel key is absent — caller keeps CT.gov-only
 * signals.
 */
export async function enrichInvestigators(
  subjects: EnrichSubject[],
  opts: { concurrency?: number } = {},
): Promise<Map<string, InvestigatorEnrichment>> {
  if (!parallelEnabled() || subjects.length === 0) return new Map();
  const results = await deepSearchMany(
    subjects.map(enrichInput),
    KOL_OUTPUT_SCHEMA,
    { processor: "core", concurrency: opts.concurrency ?? 4 },
  );
  const map = new Map<string, InvestigatorEnrichment>();
  subjects.forEach((s, i) => map.set(s.name, parseEnrichment(s.name, results[i])));
  return map;
}

/**
 * Merge enrichments into CT.gov-derived investigator inputs. Trial experience stays
 * from CT.gov; pubs/society/guideline come from the web research when available.
 */
export function applyEnrichment(
  investigators: KolInvestigatorInput[],
  enrichments: Map<string, InvestigatorEnrichment>,
): KolInvestigatorInput[] {
  return investigators.map((inv) => {
    const e = enrichments.get(inv.name);
    if (!e || e.source !== "parallel") return inv;
    const signals: KolSignals = {
      ...inv.signals,
      pubsCountTa: e.pubsCountTa,
      societyRoles: e.societyRoles,
      guidelineAuthor: e.guidelineAuthor,
    };
    return { ...inv, signals };
  });
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
function dedupeCitations(cits: SourceRef[]): SourceRef[] {
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
