/**
 * Cached, offline intake fixtures — one realistic input per adapter, so the
 * whole intake layer (and `scripts/demo-intake.ts`) runs with no network and no
 * API key. These mirror the shapes real sponsors bring; they are illustrative
 * demo artifacts, not verbatim regulatory documents.
 */

/**
 * A cached EU Clinical Trials Register (EudraCT) record — registry text lane.
 * EudraCT numbers look like YYYY-NNNNNN-CC. The EU register has no clean public
 * JSON API (unlike CT.gov), so the live path is best-effort and this verified
 * fixture is the honest fallback for a known id.
 */
export const EUCTR_FIXTURE = {
  eudractNumber: "2019-000123-45",
  title: "A Phase III trial of Drug Z in HER2-negative advanced gastric cancer",
  sponsor: "European Oncology Consortium",
  conditions: ["Advanced gastric cancer"],
  eligibilityText: `Inclusion Criteria:
- Age >= 18 years.
- Histologically confirmed gastric adenocarcinoma.
- Advanced or metastatic disease.
- ECOG performance status 0 or 1.

Exclusion Criteria:
- HER2-positive disease.
- Prior systemic therapy for advanced disease.
- Left ventricular ejection fraction < 50%.`,
  sourceUrl: "https://www.clinicaltrialsregister.eu/ctr-search/trial/2019-000123-45/results",
} as const;

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
