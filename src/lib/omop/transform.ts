/**
 * Criterion[] -> OmopCriterion[]. Pure, no I/O beyond reading the frozen
 * concept-map.json (via conceptResolver) — parallel to the deterministic
 * matcher, not a replacement for it: `matcher/engine.ts` still evaluates
 * against the synthetic `Patient` shape unchanged.
 *
 * Concept resolution now flows through the shared concept map
 * (src/lib/omop/conceptResolver.ts -> concept-map.json), the single source of
 * truth also read by the Python estimator. This replaced the old conceptId=0 /
 * vocab-index.json path; each OmopCriterion additionally carries its
 * answerability tier and (for base-tier conditions) the CID-10 join prefixes.
 */

import type { Criterion, CriterionValue } from "@/lib/matcher/types";
import type { Assertion, OmopCriterion } from "./types";
import { resolveConceptEntry, entryToOmopConcept } from "./conceptResolver";

/** inclusion -> the concept must be PRESENT; exclusion -> it must be ABSENT (PRD v4 Tier 2 assertion model). */
function assertionFor(kind: Criterion["kind"]): Assertion {
  return kind === "inclusion" ? "PRESENT" : "ABSENT";
}

function stringifyValue(value: CriterionValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

export function toOmopCriteria(criteria: Criterion[]): OmopCriterion[] {
  return criteria.map((c) => {
    const entry = resolveConceptEntry(c);
    return {
      criterionId: c.id,
      sourceField: c.field,
      sourceValue: stringifyValue(c.value),
      assertion: assertionFor(c.kind),
      concept: entryToOmopConcept(entry),
      operator: c.operator,
      value: c.value,
      unit: c.unit ?? null,
      answerability: entry.answerability,
      icd10Prefixes: entry.icd10 ? entry.icd10.prefixes : null,
    };
  });
}
