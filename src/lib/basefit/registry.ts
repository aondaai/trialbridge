/**
 * Base-fit registry — the single source of truth for which criteria the REAL
 * base can answer, and how. `depth` mirrors the estimator's proprietary NLP
 * features (estimator/trialbridge/{protocols,schema}.py); `nlp_extractable`
 * lists concepts the NLP layer could pull from pt-BR clinical text but doesn't
 * yet. See docs/superpowers/specs/2026-07-12-parse-base-fit-tiers-design.md.
 */
import type { BaseFit, Criterion, Evaluability } from "@/lib/matcher/types";

export const CHECKABLE_FIELDS: ReadonlySet<string> = new Set(["dx", "age", "sex"]);

// Exactly the features the REAL proprietary NLP extraction produces
// (estimator/trialbridge/data.py RealProprietary SELECT; protocols.py
// hero_protocol_real). stage / prior_lines are NOT extracted — they live in
// NLP_CATALOG (extractable, not yet a feature).
export const DEPTH_FEATURES: ReadonlySet<string> = new Set([
  "her2", "ecog", "metastatic", "autoimmune",
]);

/** Legacy/alternate field names → canonical registry key. */
const ALIASES: Readonly<Record<string, string>> = {
  her2_status: "her2",
  lvef: "ejection_fraction",
  diagnosis: "dx",
};

export interface NlpConcept {
  label: string;
  /** pt-BR clinical-text phrases the NLP layer would search. */
  termsPtBr: string[];
}

export const NLP_CATALOG: Readonly<Record<string, NlpConcept>> = {
  hiv: { label: "HIV infection", termsPtBr: ["HIV", "vírus da imunodeficiência humana", "AIDS", "SIDA"] },
  hepatitis_b: { label: "Hepatitis B", termsPtBr: ["hepatite B", "HBV"] },
  hepatitis_c: { label: "Hepatitis C", termsPtBr: ["hepatite C", "HCV"] },
  active_hepatitis: { label: "Active hepatitis / liver disease", termsPtBr: ["hepatite ativa", "hepatite viral", "doença hepática ativa"] },
  diabetes: { label: "Diabetes", termsPtBr: ["diabetes", "diabetes mellitus", "DM descompensado"] },
  solid_organ_transplant: { label: "Solid organ transplant", termsPtBr: ["transplante de órgão", "transplante de órgão sólido", "transplantado"] },
  interstitial_lung_disease: { label: "Interstitial lung disease", termsPtBr: ["doença pulmonar intersticial", "DPI", "pneumonite intersticial"] },
  significant_cardiac_disease: { label: "Significant cardiac disease", termsPtBr: ["doença cardíaca", "cardiopatia", "insuficiência cardíaca"] },
  ejection_fraction: { label: "LV ejection fraction", termsPtBr: ["fração de ejeção", "FEVE", "fração de ejeção do ventrículo esquerdo"] },
  stage: { label: "Tumor stage", termsPtBr: ["estadiamento", "estádio", "estágio clínico", "EC IV", "doença avançada"] },
  prior_lines: { label: "Prior lines of therapy", termsPtBr: ["linha de tratamento", "linhas prévias", "terapia prévia", "linhas anteriores", "tratamento sistêmico prévio"] },
};

export function evaluabilityFor(baseFit: BaseFit): Evaluability {
  switch (baseFit) {
    case "checkable":
    case "depth":
      return "pass_able";
    case "nlp_extractable":
      return "partial";
    case "not_answerable":
      return "not_evaluable";
  }
}

export interface BaseFitResolution {
  baseFit: BaseFit;
  nlpTerms?: string[];
  evaluability: Evaluability;
}

/**
 * Resolve a criterion's `field` to a tier PURELY from registry membership —
 * the registry is authoritative; the model's proposal is advisory. Unknown
 * fields are honestly not_answerable.
 */
export function reconcileBaseFit(field: string): BaseFitResolution {
  const raw = field.trim().toLowerCase();
  const f = ALIASES[raw] ?? raw;
  if (CHECKABLE_FIELDS.has(f)) return { baseFit: "checkable", evaluability: "pass_able" };
  if (DEPTH_FEATURES.has(f)) return { baseFit: "depth", evaluability: "pass_able" };
  const concept = NLP_CATALOG[f];
  if (concept) return { baseFit: "nlp_extractable", nlpTerms: concept.termsPtBr, evaluability: "partial" };
  return { baseFit: "not_answerable", evaluability: "not_evaluable" };
}

export interface BaseFitSummary {
  answerableToday: number; // checkable + depth
  viaNlp: number;          // nlp_extractable
  needReview: number;      // not_answerable or unset
  total: number;
}

export function summarizeBaseFit(criteria: { baseFit?: BaseFit }[]): BaseFitSummary {
  const s: BaseFitSummary = { answerableToday: 0, viaNlp: 0, needReview: 0, total: criteria.length };
  for (const c of criteria) {
    if (c.baseFit === "checkable" || c.baseFit === "depth") s.answerableToday += 1;
    else if (c.baseFit === "nlp_extractable") s.viaNlp += 1;
    else s.needReview += 1;
  }
  return s;
}

/** Stamp base-fit (tier + nlpTerms + evaluability) onto pre-parsed criteria that
 *  did not go through the live-parse normalize path (e.g. cached fixtures). */
export function stampBaseFit(criteria: Criterion[]): Criterion[] {
  return criteria.map((c) => {
    const fit = reconcileBaseFit(c.field);
    const out: Criterion = { ...c, baseFit: fit.baseFit, evaluability: fit.evaluability };
    if (fit.nlpTerms) out.nlpTerms = fit.nlpTerms;
    else delete out.nlpTerms;
    return out;
  });
}
