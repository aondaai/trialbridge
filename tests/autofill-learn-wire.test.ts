import { describe, it, expect } from "vitest";
import { classifyField } from "@/lib/feasibility-autofill/classify";
import { synonymWriteback } from "@/lib/feasibility-autofill/learn";

describe("FIN-4 · US-6 learn — the classifier consumes learned synonyms", () => {
  const field = { section: "Matriz de Variáveis", label: "Fenótipo XYZ não catalogado" };

  it("a B-field is unmapped before learning", () => {
    const before = classifyField(field);
    expect(before.archetype).toBe("B");
    expect(before.concept).toBeNull();
    expect(before.method).toBe("unmapped");
  });

  it("after a human maps the phrasing, the same label resolves to that concept", () => {
    // The learning loop persists this (via synonymWriteback → ConceptSynonym); here we feed the
    // normalized term back as the classifier's learned map, exactly as loadLearnedSynonyms would.
    const learned = synonymWriteback("custom_phenotype", field.label);
    expect(learned).not.toBeNull();
    const map = { [learned!.conceptId]: [learned!.term] };

    const after = classifyField(field, map);
    expect(after.concept).toBe("custom_phenotype");
    expect(after.method).toBe("synonym");
  });

  it("learned synonyms don't disturb existing mappings", () => {
    const c = classifyField({ section: "Variáveis", label: "Idade" }, { custom_phenotype: ["fenotipo xyz nao catalogado"] });
    expect(c.concept).toBe("age");
  });
});
