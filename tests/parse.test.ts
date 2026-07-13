import { describe, it, expect, beforeEach } from "vitest";
import { parseCriteria, parseCriteriaDeterministically } from "@/lib/parse";
import { stampBaseFit } from "@/lib/basefit/registry";
import { HERO_CRITERIA, HERO_META } from "@/data/hero-protocol";
import { NSCLC_CRITERIA, NSCLC_META } from "@/data/nsclc-kras-protocol";
import { IAM1363_CRITERIA, IAM1363_META } from "@/data/iambic-iam1363-protocol";
import { RELAY_REDEFINE_CRITERIA, RELAY_REDEFINE_META } from "@/data/relay-redefine-protocol";
import { RENTOSERTIB_IPF_CRITERIA, RENTOSERTIB_IPF_META } from "@/data/rentosertib-ipf-protocol";

describe("parse service — cached fallback (no API key)", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back to the cached verified criteria when the nctId matches a known fixture", async () => {
    const result = await parseCriteria("Age >= 18 years.\nHER2-positive.", HERO_META.nct);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(HERO_CRITERIA));
    expect(result.criteria.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/previously validated eligibility criteria/i);
    expect(result.note).not.toContain("ANTHROPIC_API_KEY");
  });

  it("matches fixtures by nctId regardless of casing/whitespace", async () => {
    const result = await parseCriteria("anything", `  ${NSCLC_META.nct.toLowerCase()}  `);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(NSCLC_CRITERIA));
  });

  it("supports the documented IAM1363 flow offline", async () => {
    const result = await parseCriteria("ClinicalTrials.gov eligibility text", IAM1363_META.nct);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(IAM1363_CRITERIA));
    expect(result.criteria).toHaveLength(17);
    expect(result.note).toContain(IAM1363_META.nct);
  });

  it("supports NCT06982521 offline without borrowing another trial's criteria", async () => {
    const result = await parseCriteria("ClinicalTrials.gov eligibility text", RELAY_REDEFINE_META.nct);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(RELAY_REDEFINE_CRITERIA));
    expect(result.criteria).toHaveLength(26);
    expect(result.criteria.some((criterion) => criterion.field === "pik3ca_mutation")).toBe(true);
    expect(result.note).toContain(RELAY_REDEFINE_META.nct);
  });

  it("supports NCT07687459 offline with its IPF criteria", async () => {
    const result = await parseCriteria("ClinicalTrials.gov eligibility text", RENTOSERTIB_IPF_META.nct);
    expect(result.source).toBe("cached");
    expect(result.criteria).toEqual(stampBaseFit(RENTOSERTIB_IPF_CRITERIA));
    expect(result.criteria).toHaveLength(50);
    expect(result.criteria.some((criterion) => criterion.field === "fvc_percent_predicted")).toBe(true);
    expect(result.criteria.some((criterion) => criterion.field === "diagnosis" && criterion.value === "idiopathic pulmonary fibrosis")).toBe(true);
    expect(result.note).toContain(RENTOSERTIB_IPF_META.nct);
  });

  it("returns criteria the deterministic matcher can consume (shape check)", async () => {
    const { criteria } = await parseCriteria("anything", HERO_META.nct);
    for (const c of criteria) {
      expect(["inclusion", "exclusion"]).toContain(c.kind);
      expect(typeof c.field).toBe("string");
      expect(typeof c.rawText).toBe("string");
    }
  });

  it("creates a conservative draft for an unlisted NCT", async () => {
    const text = `Inclusion Criteria:\n\n* Histologically confirmed mature B-cell malignancy.\n* ECOG performance status of 0 or 1.\n\nExclusion Criteria:\n\n* Symptomatic CNS involvement.`;
    const result = await parseCriteria(text, "NCT05544019");
    expect(result.source).toBe("deterministic");
    expect(result.criteria).toHaveLength(3);
    expect(result.criteria[0]).toMatchObject({ kind: "inclusion", field: "diagnosis", value: "mature b-cell malignancy" });
    expect(result.criteria[1]).toMatchObject({ field: "ecog", value: [0, 1], baseFit: "depth" });
    expect(result.criteria[2]).toMatchObject({ kind: "exclusion", baseFit: "not_answerable" });
    expect(result.note).toContain("NCT05544019");
  });

  it("parses supplied eligibility text without an NCT instead of borrowing a fixture", async () => {
    const criteria = parseCriteriaDeterministically("Inclusion Criteria:\n\nAge >= 21 years.\n\nExclusion Criteria:\n\nActive infection.");
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toMatchObject({ field: "age", operator: "gte", value: 21 });
    expect(criteria[1]).toMatchObject({ kind: "exclusion", baseFit: "not_answerable" });
  });
});
