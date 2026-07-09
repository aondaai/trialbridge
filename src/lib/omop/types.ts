/**
 * The OMOP coding layer — a parallel representation of `Criterion[]` that
 * attaches an OMOP CDM domain/table, a standard-vocabulary concept, and a
 * clinical assertion to each criterion. This is the artifact a future
 * OMOP-native matcher needs to query real OMOP databases (DataSUS national
 * aggregate, DoctorAssistant NLP->OMOP row-level) instead of only the
 * synthetic `Patient` fixture `matcher/engine.ts` runs against today — see
 * docs/trialbridge-prd-v4.md, "OMOP-native matching engine, dual-path".
 *
 * Honesty rule (see docs/omop-vocabulary-mapping.md): a numeric OMOP
 * `conceptId` is populated ONLY when it's a verified, checkable value.
 * Everything else uses OMOP's own convention for "not yet mapped":
 * `conceptId: 0`, `sourceValue` populated, `needsMapping: true`. Real
 * concept_ids require an OHDSI Athena vocabulary lookup, which is future
 * work, not something asserted from memory (docs/citations.md is this
 * repo's precedent for not overclaiming unverifiable numbers).
 */

import type { Operator, CriterionValue } from "@/lib/matcher/types";

export type OmopDomain = "Person" | "Condition" | "Measurement" | "Observation" | "Drug" | "Device";

export type OmopTable =
  | "person"
  | "condition_occurrence"
  | "measurement"
  | "observation"
  | "drug_exposure"
  | "device_exposure";

export type VocabularyId = "SNOMED" | "LOINC" | "RxNorm" | "Gender" | "None";

/**
 * Whether a real-world OMOP row can carry this criterion's positive/negative
 * expectation — mirrors the DoctorAssistant NLP->OMOP `assertion` field
 * (docs/trialbridge-prd-v4.md Tier 2). Derived here from `Criterion.kind`:
 * inclusion -> the concept must be PRESENT; exclusion -> it must be ABSENT.
 * HISTORY/FAMILY_HISTORY/INVESTIGATION/OTHER exist in the type for
 * forward-compatibility with that Tier 2 model but are not yet inferred.
 */
export type Assertion = "PRESENT" | "ABSENT" | "HISTORY" | "FAMILY_HISTORY" | "INVESTIGATION" | "OTHER";

export interface OmopConcept {
  domain: OmopDomain;
  table: OmopTable;
  vocabularyId: VocabularyId;
  /** Standard OMOP concept_id. 0 = unmapped (OMOP's own convention). */
  conceptId: number;
  conceptName: string;
  /** True only for concepts checked against a real, citable vocabulary source. */
  verified: boolean;
  /** True whenever conceptId is 0 — flags this field for real vocabulary lookup before OMOP-native matching goes live. */
  needsMapping: boolean;
}

export interface OmopCriterion {
  criterionId: string;
  /** The Criterion.field this came from, e.g. "her2_status". */
  sourceField: string;
  /** The Criterion.value, stringified for the source_value column. */
  sourceValue: string;
  assertion: Assertion;
  concept: OmopConcept;
  /**
   * The original Criterion's operator/value/unit, carried through unchanged.
   * `sourceValue` above is a display string; a real query (src/lib/omop/datasource/)
   * needs the structured form to build a WHERE clause (e.g. a numeric
   * threshold against measurement.value_as_number).
   */
  operator: Operator;
  value: CriterionValue;
  unit: string | null;
  /**
   * Tier from the shared concept map (§2.2 answerability): "datasus" = exact
   * base cohort, "depth" = estimated via enrichment, "ambos" = both. Optional
   * so older callers/fixtures without a resolver remain valid.
   */
  answerability?: "datasus" | "depth" | "ambos";
  /** For datasus-tier condition criteria: the CID-10 LIKE prefixes; null otherwise. */
  icd10Prefixes?: string[] | null;
}
