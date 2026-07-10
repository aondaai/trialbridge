/**
 * Cached, offline intake fixtures — one realistic input per adapter, so the
 * whole intake layer (and `scripts/demo-intake.ts`) runs with no network and no
 * API key. These mirror the shapes real sponsors bring; they are illustrative
 * demo artifacts, not verbatim regulatory documents.
 */

/** A FHIR R5 EvidenceVariable for a HER2+ mBC 2nd-line trial (structured lane). */
export const FHIR_EVIDENCE_VARIABLE = {
  resourceType: "EvidenceVariable",
  id: "ev-her2-mbc-2l",
  title: "HER2+ metastatic breast cancer — 2L eligibility",
  status: "active",
  characteristic: [
    {
      description: "Age >= 18 years",
      definitionByTypeAndValue: {
        type: { text: "Age" },
        valueQuantity: { value: 18, comparator: ">=", unit: "years" },
      },
    },
    {
      description: "ECOG performance status 0-1",
      definitionByTypeAndValue: {
        type: { text: "ECOG performance status" },
        valueRange: { low: { value: 0 }, high: { value: 1 } },
      },
    },
    {
      description: "HER2-positive",
      definitionByTypeAndValue: {
        type: { coding: [{ system: "http://snomed.info/sct", code: "427685000", display: "HER2 status" }] },
        valueCodeableConcept: { text: "positive" },
      },
    },
    {
      description: "Active brain metastases",
      exclude: true,
      definitionByTypeAndValue: {
        type: { text: "Brain metastases" },
        valueBoolean: true,
      },
    },
    {
      description: "LVEF < 50%",
      exclude: true,
      definitionByTypeAndValue: {
        type: { text: "Left ventricular ejection fraction" },
        valueQuantity: { value: 50, comparator: "<", unit: "%" },
      },
    },
  ],
} as const;
