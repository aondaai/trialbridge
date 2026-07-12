import { describe, it, expect } from "vitest";
import {
  resolveProfileByLabel,
  resolveProfileField,
  profileKeyForLabel,
  type ProfileLike,
} from "@/lib/feasibility-autofill/resolvers/profile";
import {
  resolveCapability,
  isCapable,
  type CapabilityLike,
} from "@/lib/feasibility-autofill/resolvers/capability";
import { isMetric, assertProvenanced, Provenance, Confidence } from "@/lib/metric";

const PROFILE: ProfileLike = {
  legalName: "iHealth (demo)",
  address: "Av. Paulista 1000, São Paulo",
  email: "base@ihealth.example",
  phone: "+55 11 5555-0000",
  website: "https://ihealth.example",
  anonymizationLevel: "pseudonymized",
  lgpdBasis: "consentimento",
  ethicsCommittee: "CEP FMUSP",
  contractingDaysEst: 45,
  acceptsEsignature: true,
  materials: JSON.stringify({ data_dictionary: true, flowchart: false }),
};

describe("F2-1 · profile resolver (archetype A)", () => {
  it("resolves institution name as a provenanced Metric (SITE_DECLARED)", () => {
    const m = resolveProfileField(PROFILE, "institution_name", "2026-07-11T00:00:00Z");
    expect(isMetric(m)).toBe(true);
    expect(m.value).toBe("iHealth (demo)");
    expect(m.provenance).toBe(Provenance.SITE_DECLARED);
    expect(m.asOf).toBe("2026-07-11T00:00:00Z");
  });

  it("maps PT-BR labels to the right profile key", () => {
    expect(profileKeyForLabel("Nome / endereço / e-mail / site da instituição")).toBe(
      "institution_name",
    );
    expect(profileKeyForLabel("Base anonimizada / pseudonimizada / identificável")).toBe(
      "anonymization_level",
    );
    expect(profileKeyForLabel("Aceita assinatura digital?")).toBe("accepts_esignature");
    expect(profileKeyForLabel("Dicionário de dados disponível?")).toBe("has_data_dictionary");
  });

  it("reads a boolean material flag", () => {
    const m = resolveProfileField(PROFILE, "has_data_dictionary");
    expect(m.value).toBe("yes");
  });

  it("degrades to an unavailable Metric (not a blank) for unmapped labels", () => {
    const m = resolveProfileByLabel(PROFILE, "Qual a cor favorita do PI?");
    expect(isMetric(m)).toBe(true);
    expect(m.value).toBeNull();
    expect(m.confidence).toBe(Confidence.LOW);
  });

  it("every profile answer passes the provenance gate", () => {
    const answers = {
      metrics: [
        resolveProfileField(PROFILE, "institution_name"),
        resolveProfileField(PROFILE, "anonymization_level"),
        resolveProfileField(PROFILE, "contracting_days"),
      ],
    };
    expect(assertProvenanced(answers)).toBe(3);
  });
});

const CAP: CapabilityLike = {
  conceptId: "ibd",
  available: "yes",
  identificationMethod: "NLP (NER) + assertion detection",
  sourceField: "entity(label=DISEASE) + term_code",
  completenessValue: 0.92,
  completenessQual: "high",
  notes: "Asserção PRESENTE/AUSENTE disponível",
};

describe("F2-2 · capability resolver (archetype B)", () => {
  it("resolves availability as a provenanced Metric with completeness→confidence", () => {
    const m = resolveCapability("ibd", CAP, "2026-07-11T00:00:00Z");
    expect(isMetric(m)).toBe(true);
    expect(m.value).toBe("yes");
    expect(m.provenance).toBe(Provenance.SITE_DECLARED);
    expect(m.confidence).toBe(Confidence.HIGH);
    expect(m.ci).toEqual([0.92, 0.92]);
    expect(m.note).toContain("method:");
    expect(isCapable(m)).toBe(true);
  });

  it("moderate completeness → MEDIUM confidence", () => {
    const m = resolveCapability("ldl", { ...CAP, conceptId: "ldl", completenessQual: "moderate" });
    expect(m.confidence).toBe(Confidence.MEDIUM);
  });

  it("a concept absent from the catalog is unavailable — never a guessed yes", () => {
    const m = resolveCapability("rare_biomarker", null);
    expect(m.value).toBeNull();
    expect(m.confidence).toBe(Confidence.LOW);
    expect(isCapable(m)).toBe(false);
    expect(m.note).toContain("not in capability catalog");
  });
});
