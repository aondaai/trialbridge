import type {
  RegistryTrialProfile,
  SiteFeasibilityQuery,
  TrialRelevance,
} from "@/lib/site-feasibility/types";

const ACTIVE_STATUSES = new Set([
  "NOT_YET_RECRUITING",
  "RECRUITING",
  "ENROLLING_BY_INVITATION",
  "ACTIVE_NOT_RECRUITING",
]);

const CONDITION_STOPWORDS = new Set([
  "and", "cancer", "carcinoma", "disease", "disorder", "malignant", "neoplasm",
  "of", "or", "the", "tumor", "tumors", "tumour", "tumours", "with",
]);

const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/non[ -]?small[ -]?cell lung cancer/g, "nsclc"],
  [/small[ -]?cell lung cancer/g, "sclc"],
  [/human epidermal growth factor receptor 2/g, "her2"],
  [/programmed death ligand 1/g, "pdl1"],
  [/triple[ -]?negative breast cancer/g, "tnbc"],
];

export function normalizeClinicalText(value: string): string {
  let normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

function significantTokens(value: string): string[] {
  return normalizeClinicalText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !CONDITION_STOPWORDS.has(token));
}

function termMatches(term: string, corpus: string): boolean {
  const normalizedTerm = normalizeClinicalText(term);
  if (!normalizedTerm) return false;
  if (corpus.includes(normalizedTerm)) return true;
  const tokens = significantTokens(normalizedTerm);
  if (tokens.length === 0) return false;
  const corpusTokens = new Set(significantTokens(corpus));
  const matched = tokens.filter((token) => corpusTokens.has(token)).length;
  return matched >= Math.max(1, Math.ceil(tokens.length * 0.6));
}

function anyTermMatches(terms: string[], corpus: string): boolean {
  return terms.some((term) => termMatches(term, corpus));
}

function normalizePhase(value: string): string {
  return normalizeClinicalText(value).replace(/^phase /, "");
}

export function classifyTrialRelevance(
  query: SiteFeasibilityQuery,
  trial: RegistryTrialProfile,
): TrialRelevance {
  const conditionCorpus = normalizeClinicalText(trial.conditions.join(" "));
  const fullCorpus = normalizeClinicalText([
    trial.title,
    ...trial.conditions,
    ...trial.interventions,
  ].join(" "));

  const indicationMatch = termMatches(query.condition, conditionCorpus || fullCorpus);
  const biomarkerMatch = (query.biomarkers?.length ?? 0) > 0
    ? anyTermMatches(query.biomarkers ?? [], fullCorpus)
    : false;
  const interventionMatch = (query.interventionTerms?.length ?? 0) > 0
    ? anyTermMatches(query.interventionTerms ?? [], fullCorpus)
    : false;
  const wantedPhases = new Set((query.phases ?? []).map(normalizePhase));
  const phaseMatch = wantedPhases.size > 0
    ? trial.phases.some((phase) => wantedPhases.has(normalizePhase(phase)))
    : false;

  const category = indicationMatch
    ? biomarkerMatch
      ? "same_biomarker"
      : "same_indication"
    : biomarkerMatch || interventionMatch
      ? "adjacent"
      : "not_relevant";

  const score = Math.min(100,
    (indicationMatch ? 60 : 0) +
    (biomarkerMatch ? 20 : 0) +
    (phaseMatch ? 10 : 0) +
    (interventionMatch ? 10 : 0),
  );
  const isTarget = Boolean(query.targetNctId) &&
    trial.nctId.toUpperCase() === query.targetNctId?.toUpperCase();

  return {
    nctId: trial.nctId,
    category,
    indicationMatch,
    biomarkerMatch,
    phaseMatch,
    interventionMatch,
    activeCandidateCompetitor:
      !isTarget && category !== "not_relevant" && ACTIVE_STATUSES.has(trial.status ?? ""),
    score,
  };
}
