/**
 * Criterion[] -> OmopCriterion[]. Pure, no I/O — parallel to the
 * deterministic matcher, not a replacement for it: `matcher/engine.ts`
 * still evaluates against the synthetic `Patient` shape unchanged. This is
 * the artifact a future OMOP-native matcher would use to query real
 * DataSUS/DoctorAssistant OMOP tables (docs/trialbridge-prd-v4.md).
 */

import type { Criterion, CriterionValue } from "@/lib/matcher/types";
import type { Assertion, OmopConcept, OmopCriterion, VocabularyId } from "./types";
import { FIELD_CONCEPT_MAP, UNMAPPED_FIELD_CONCEPT, VERIFIED_GENDER_CONCEPTS } from "./vocabulary";
import { loadVocabIndex } from "./vocabIndex";

/** inclusion -> the concept must be PRESENT; exclusion -> it must be ABSENT (PRD v4 Tier 2 assertion model). */
function assertionFor(kind: Criterion["kind"]): Assertion {
  return kind === "inclusion" ? "PRESENT" : "ABSENT";
}

function stringifyValue(value: CriterionValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

function resolveConcept(c: Criterion): OmopConcept {
  const base = FIELD_CONCEPT_MAP[c.field] ?? UNMAPPED_FIELD_CONCEPT;

  let conceptId = base.conceptId ?? 0;
  let conceptName = base.conceptName;
  let vocabularyId: VocabularyId = base.vocabularyId;
  let verified = base.verified ?? false;

  // Real vocabulary mapping (data/vocab-index.json), built by
  // `npm run build-vocab-index` from a user-supplied Athena bundle — see
  // docs/omop-vocabulary-mapping.md. Absent by default, in which case this
  // is a no-op and behavior is identical to Phase 1.
  const indexed = loadVocabIndex()?.[base.conceptName];
  if (indexed) {
    conceptId = indexed.conceptId;
    conceptName = indexed.conceptName;
    vocabularyId = indexed.vocabularyId as VocabularyId;
    verified = true;
  }

  // The one value-aware verified mapping shipped without any external data:
  // OMOP Gender concepts by value. Takes precedence over an index hit since
  // it's per-value, not per-field.
  if (c.field === "sex" && typeof c.value === "string") {
    const known = VERIFIED_GENDER_CONCEPTS[c.value.toLowerCase()];
    if (known !== undefined) {
      conceptId = known;
      verified = true;
    }
  }

  return {
    domain: base.domain,
    table: base.table,
    vocabularyId,
    conceptName,
    conceptId,
    verified,
    needsMapping: conceptId === 0,
  };
}

export function toOmopCriteria(criteria: Criterion[]): OmopCriterion[] {
  return criteria.map((c) => ({
    criterionId: c.id,
    sourceField: c.field,
    sourceValue: stringifyValue(c.value),
    assertion: assertionFor(c.kind),
    concept: resolveConcept(c),
    operator: c.operator,
    value: c.value,
    unit: c.unit ?? null,
  }));
}
