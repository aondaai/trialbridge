import { describe, it, expect } from "vitest";
import {
  ALL_CONSTANTS,
  amendmentCost,
  brazilCostAddsUsd,
  vendorConstantsAreNotPeerReviewed,
  COST_LATAM_PCT_OF_NA,
  COST_ONC_SAVING_VENDOR,
  AMENDMENT_COST_PH2,
  AMENDMENT_COST_PH3,
} from "@/lib/constants";
import { isMetric, Provenance } from "@/lib/metric";

describe("constants library — every constant is a well-formed, cited Metric", () => {
  it("all constants pass isMetric and carry at least one source ref", () => {
    for (const c of ALL_CONSTANTS) {
      expect(isMetric(c), `${c.key} should be a Metric`).toBe(true);
      expect((c.sourceRefs ?? []).length, `${c.key} needs a citation`).toBeGreaterThan(0);
    }
  });

  it("keys are unique", () => {
    const keys = ALL_CONSTANTS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("honest labeling (docs/citations.md discipline)", () => {
  it("the peer-reviewed cost anchor is Qiao's 59%-of-NA, sealed PEER_REVIEWED", () => {
    expect(COST_LATAM_PCT_OF_NA.value).toBe(59);
    expect(COST_LATAM_PCT_OF_NA.provenance).toBe(Provenance.PEER_REVIEWED);
  });

  it('the L.E.K. "65% oncology" figure is VENDOR, never peer-reviewed', () => {
    expect(COST_ONC_SAVING_VENDOR.value).toBe(65);
    expect(COST_ONC_SAVING_VENDOR.provenance).toBe(Provenance.VENDOR);
  });

  it("no vendor/shaky constant masquerades as peer-reviewed", () => {
    expect(vendorConstantsAreNotPeerReviewed()).toBe(true);
  });
});

describe("amendmentCost() — phase lookup for the softening simulator", () => {
  it("returns the Phase II figure for II", () => {
    expect(amendmentCost("II")).toBe(AMENDMENT_COST_PH2);
    expect(amendmentCost(2).value).toBe(141000);
  });
  it("returns the Phase III figure for III", () => {
    expect(amendmentCost("III")).toBe(AMENDMENT_COST_PH3);
    expect(amendmentCost(3).value).toBe(535000);
  });
});

describe("brazilCostAddsUsd() — the saving is netted against real Brazil costs", () => {
  it("sums the three Brazil-specific per-patient adds", () => {
    expect(brazilCostAddsUsd()).toBe(10000 + 16500 + 5500);
  });
});
