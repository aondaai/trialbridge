import type { SiteFeasibilityQuery } from "@/lib/site-feasibility/types";

const BIOMARKER_PATTERNS: Array<[RegExp, string]> = [
  [/\bkras\s*g12c\b/i, "KRAS G12C"],
  [/\bher2(?:\+|[- ]positive)?\b/i, "HER2"],
  [/\begfr\b/i, "EGFR"],
  [/\balk\b/i, "ALK"],
  [/\bros1\b/i, "ROS1"],
  [/\bbraf\s*v600e\b/i, "BRAF V600E"],
  [/\bmsi[- ]?h\b/i, "MSI-H"],
  [/\bdmmr\b/i, "dMMR"],
  [/\bpd[- ]?l1\b/i, "PD-L1"],
];

export function inferBiomarkers(text: string): string[] {
  return BIOMARKER_PATTERNS
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label);
}

export function inferConditionFromTitle(title: string): string {
  const normalized = title.toLowerCase();
  if (/breast/.test(normalized)) return "breast cancer";
  if (/nsclc|lung/.test(normalized)) return "non-small cell lung cancer";
  if (/melanoma/.test(normalized)) return "melanoma";
  if (/colorectal|\bcrc\b/.test(normalized)) return "colorectal cancer";
  return title.replace(/^phase\s+[ivx]+\s*[—-]\s*/i, "").replace(/\([^)]*\)/g, "").trim() || title;
}

export function siteFeasibilityQueryFromProtocol(input: {
  condition: string;
  title: string;
  nctId?: string | null;
  phase?: string | null;
}): SiteFeasibilityQuery {
  return {
    condition: input.condition,
    title: input.title,
    targetNctId: input.nctId ?? null,
    phases: input.phase && input.phase !== "Not specified" ? [input.phase] : [],
    biomarkers: inferBiomarkers(input.title),
    interventionTerms: [],
  };
}
