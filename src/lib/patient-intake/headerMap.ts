/**
 * Heuristic header → Patient-field mapping. Deterministic, offline. A header
 * that looks clinical but matches nothing known routes to "biomarker" (kept in
 * the open biomarkers map) rather than "ignore", so we don't silently drop
 * signal. The verify UI lets the coordinator override any of these.
 */
import type { MapTarget } from "./types";

const RULES: [RegExp, MapTarget][] = [
  [/^(mrn|patient\s*id|record\s*id|id)$/i, "id"],
  [/dx|diagnos/i, "diagnosis"],
  [/\bstage\b/i, "stage"],
  [/prior\s*(lines?|therap)/i, "priorLines"],
  [/ecog|perf(ormance)?\s*status|\bps\b/i, "ecog"],
  [/\bsex\b|gender/i, "sex"],
  [/\bage\b/i, "age"],
  [/her.?2/i, "her2_status"],
  [/\ber(\b|[^a-z])|estrogen/i, "er_status"],
  [/\bpr(\b|[^a-z])|progest/i, "pr_status"],
  [/creat/i, "creatinine"],
  [/h(a)?emoglobin|\bhgb\b|\bhb\b/i, "hemoglobin"],
  [/platelet|\bplt\b/i, "platelets"],
  [/bilirubin|\btbili\b/i, "bilirubin"],
  [/ejection\s*fraction|lvef/i, "ejection_fraction"],
];

/** Suggested target field for a raw header. Unknown clinical-ish → "biomarker". */
export function suggestTarget(header: string): MapTarget {
  const h = header.trim();
  if (h === "") return "ignore";
  for (const [re, target] of RULES) if (re.test(h)) return target;
  return "biomarker";
}

/** Pull a unit out of a parenthesized header, e.g. "Creatinine (mg/dL)" → "mg/dL". */
export function unitFromHeader(header: string): string | null {
  const m = header.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : null;
}
