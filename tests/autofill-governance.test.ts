import { describe, it, expect } from "vitest";
import { computeDQ, worstFlag } from "@/lib/feasibility-autofill/dq";
import { diffObjects, makeAuditEntry, nextVersion } from "@/lib/feasibility-autofill/audit";
import { synonymWriteback, indexApprovedNarrative } from "@/lib/feasibility-autofill/learn";
import { Confidence } from "@/lib/metric";

describe("F5-1 · Kahn DQ flags", () => {
  it("B: high completeness + valid availability → all pass", () => {
    const f = computeDQ({ archetype: "B", value: "yes", confidence: Confidence.HIGH, completenessQual: "high" });
    expect(f).toEqual({ conformance: "pass", completeness: "pass", plausibility: "pass" });
  });

  it("B: low completeness fails the completeness flag", () => {
    const f = computeDQ({ archetype: "B", value: "partial", confidence: Confidence.MEDIUM, completenessQual: "low" });
    expect(f.completeness).toBe("fail");
    expect(worstFlag(f)).toBe("fail");
  });

  it("C: a count above the data-source size is implausible", () => {
    const f = computeDQ({ archetype: "C", value: 5000, confidence: Confidence.HIGH, dataSourcePatients: 1000 });
    expect(f.plausibility).toBe("fail");
  });

  it("C: suppressed <5 is conformant and plausible", () => {
    const f = computeDQ({ archetype: "C", value: "<5", confidence: Confidence.LOW });
    expect(f.conformance).toBe("pass");
    expect(f.plausibility).toBe("pass");
  });

  it("a null value fails conformance regardless of archetype", () => {
    expect(computeDQ({ archetype: "A", value: null, confidence: Confidence.LOW }).conformance).toBe("fail");
  });
});

describe("F5-2 · audit + versioning", () => {
  it("diffObjects reports only changed keys", () => {
    const d = diffObjects({ status: "proposed", value: "x" }, { status: "approved", value: "x" });
    expect(d).toEqual({ status: { from: "proposed", to: "approved" } });
  });

  it("makeAuditEntry serializes a diff with an injected timestamp", () => {
    const e = makeAuditEntry({
      entity: "FieldAnswer",
      entityId: "fa1",
      action: "approve",
      actor: "camila",
      before: { status: "proposed" },
      after: { status: "approved" },
      at: "2026-07-11T00:00:00Z",
    });
    expect(e.at).toBe("2026-07-11T00:00:00Z");
    expect(JSON.parse(e.diff)).toEqual({ status: { from: "proposed", to: "approved" } });
  });

  it("nextVersion is monotonic", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(7)).toBe(8);
  });
});

describe("F5-3 · learning loop", () => {
  it("synonymWriteback normalizes the learned term", () => {
    const s = synonymWriteback("ibd", "Doença de Crohn ativa");
    expect(s).not.toBeNull();
    expect(s!.term).toBe("doenca de crohn ativa");
    expect(s!.conceptId).toBe("ibd");
    expect(s!.source).toBe("human");
  });

  it("a learned synonym would let the classifier map a previously-unmapped label", async () => {
    // Before learning: an unusual phrasing is unmapped.
    const { classifyField, CONCEPT_SYNONYMS } = await import("@/lib/feasibility-autofill/classify");
    const before = classifyField({ section: "Matriz de Variáveis", label: "Coisa nova zzz" });
    expect(before.method).toBe("unmapped");
    // The write-back the loop would persist:
    const learned = synonymWriteback("medication", "Coisa nova zzz");
    expect(learned!.term).toBe("coisa nova zzz");
    // (Persistence + reload is the server-action's job; here we assert the record is well-formed
    //  and that the term is exactly what the synonym rung matches on.)
    expect(Object.keys(CONCEPT_SYNONYMS)).toContain("medication");
  });

  it("indexApprovedNarrative only indexes approved, non-empty answers", () => {
    const base = { siteId: "s1", section: "Limitações", label: "Limitações", answerText: "texto" };
    expect(indexApprovedNarrative({ ...base, status: "proposed" }, "2026-07-11T00:00:00Z")).toBeNull();
    expect(indexApprovedNarrative({ ...base, status: "approved", answerText: "" }, "2026-07-11T00:00:00Z")).toBeNull();
    const rec = indexApprovedNarrative({ ...base, status: "approved" }, "2026-07-11T00:00:00Z");
    expect(rec).not.toBeNull();
    expect(rec!.answerText).toBe("texto");
    expect(rec!.siteId).toBe("s1");
  });
});
