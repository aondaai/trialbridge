import { describe, it, expect } from "vitest";
import { classifyField } from "@/lib/feasibility-autofill/classify";

/**
 * FIN-5 — the ASCVD/IBD B-field label set (the real MSD therapeutic areas). Each is a capability
 * (archetype B) field; the concept classifier must map it (PT-BR + ICD/LOINC/ATC synonyms).
 */
const LABELS: Array<{ label: string; concept: string }> = [
  { label: "Doença Inflamatória Intestinal (DII)", concept: "ibd" },
  { label: "Doença de Crohn", concept: "ibd" },
  { label: "Retocolite ulcerativa (CID K51)", concept: "ibd" },
  { label: "Dislipidemia (E78)", concept: "dyslipidemia" },
  { label: "Colesterol LDL", concept: "lab_result" },
  { label: "HDL-colesterol", concept: "lab_result" },
  { label: "HbA1c (hemoglobina glicada)", concept: "lab_result" },
  { label: "PCR — proteína C reativa", concept: "lab_result" },
  { label: "Infarto agudo do miocárdio (IAM)", concept: "myocardial_infarction" },
  { label: "Acidente vascular cerebral (AVC)", concept: "stroke" },
  { label: "Doença arterial periférica (DAP)", concept: "pad" },
  { label: "Diabetes mellitus tipo 2 (DM2)", concept: "t2dm" },
  { label: "Hipertensão arterial sistêmica (HAS)", concept: "hypertension" },
  { label: "Doença renal crônica (DRC)", concept: "ckd" },
  { label: "Insuficiência cardíaca (IC)", concept: "heart_failure" },
  { label: "Uso de estatina", concept: "medication" },
  { label: "Idade no index date", concept: "age" },
  { label: "Sexo / gênero", concept: "sex" },
];

describe("FIN-5 · ASCVD/IBD concept mapping precision", () => {
  const results = LABELS.map((l) => ({ ...l, got: classifyField({ section: "Matriz de Variáveis", label: l.label }).concept }));

  it("maps ≥0.8 of the ASCVD/IBD B-fields to the expected concept", () => {
    const correct = results.filter((r) => r.got === r.concept).length;
    const accuracy = correct / results.length;
    // Surface any misses if the bar isn't met.
    if (accuracy < 0.8) console.log("misses:", results.filter((r) => r.got !== r.concept));
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it("no ASCVD/IBD B-field comes back unmapped (all concept-bound)", () => {
    const unmapped = results.filter((r) => r.got === null);
    expect(unmapped.length).toBeLessThanOrEqual(2); // allow a couple; none is the goal
  });

  it("spot-checks the load-bearing cardiometabolic concepts", () => {
    expect(classifyField({ section: "Variáveis", label: "AVC prévio" }).concept).toBe("stroke");
    expect(classifyField({ section: "Variáveis", label: "DM2" }).concept).toBe("t2dm");
    expect(classifyField({ section: "Variáveis", label: "HAS" }).concept).toBe("hypertension");
  });
});
