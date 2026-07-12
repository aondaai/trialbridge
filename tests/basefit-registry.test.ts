import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  reconcileBaseFit,
  evaluabilityFor,
  summarizeBaseFit,
  DEPTH_FEATURES,
  NLP_CATALOG,
} from "@/lib/basefit/registry";

describe("reconcileBaseFit", () => {
  it("classifies checkable fields", () => {
    expect(reconcileBaseFit("age").baseFit).toBe("checkable");
    expect(reconcileBaseFit("sex").baseFit).toBe("checkable");
  });
  it("classifies depth features", () => {
    expect(reconcileBaseFit("her2").baseFit).toBe("depth");
    expect(reconcileBaseFit("autoimmune").baseFit).toBe("depth");
  });
  it("aliases legacy her2_status to the her2 depth feature", () => {
    expect(reconcileBaseFit("her2_status").baseFit).toBe("depth");
  });
  it("classifies catalog concepts as nlp_extractable with pt-BR terms", () => {
    const r = reconcileBaseFit("hiv");
    expect(r.baseFit).toBe("nlp_extractable");
    expect(r.nlpTerms).toContain("HIV");
    expect(r.nlpTerms!.length).toBeGreaterThan(0);
  });
  it("treats unknown fields as not_answerable", () => {
    expect(reconcileBaseFit("able_to_swallow").baseFit).toBe("not_answerable");
    expect(reconcileBaseFit("able_to_swallow").nlpTerms).toBeUndefined();
  });
  it("treats stage and prior_lines as nlp_extractable, not depth", () => {
    expect(reconcileBaseFit("stage").baseFit).toBe("nlp_extractable");
    expect(reconcileBaseFit("prior_lines").baseFit).toBe("nlp_extractable");
  });
});

describe("evaluabilityFor", () => {
  it("maps tiers to evaluability", () => {
    expect(evaluabilityFor("checkable")).toBe("pass_able");
    expect(evaluabilityFor("depth")).toBe("pass_able");
    expect(evaluabilityFor("nlp_extractable")).toBe("partial");
    expect(evaluabilityFor("not_answerable")).toBe("not_evaluable");
  });
});

describe("summarizeBaseFit", () => {
  it("counts the three buckets", () => {
    const s = summarizeBaseFit([
      { baseFit: "checkable" }, { baseFit: "depth" },
      { baseFit: "nlp_extractable" }, { baseFit: "not_answerable" }, {},
    ]);
    expect(s).toEqual({ answerableToday: 2, viaNlp: 1, needReview: 2, total: 5 });
  });
});

describe("catalog integrity", () => {
  it("every catalog concept has at least one pt-BR term", () => {
    for (const [key, c] of Object.entries(NLP_CATALOG)) {
      expect(c.termsPtBr.length, key).toBeGreaterThan(0);
    }
  });
});

describe("estimator drift guard", () => {
  // Assert against the REAL protocol (hero_protocol_real in protocols.py), NOT
  // schema.py's type-comment — so a feature the base doesn't actually extract
  // (e.g. stage/prior_lines) cannot silently pass by matching a comment.
  it("every depth feature is used by the estimator's real protocol", () => {
    const src = readFileSync(
      resolve(process.cwd(), "estimator", "trialbridge", "protocols.py"),
      "utf8",
    );
    for (const feature of DEPTH_FEATURES) {
      expect(src, feature).toContain(`"${feature}"`);
    }
  });
  it("depth is exactly the 4 really-extracted features", () => {
    expect([...DEPTH_FEATURES].sort()).toEqual(
      ["autoimmune", "ecog", "her2", "metastatic"],
    );
  });
});
