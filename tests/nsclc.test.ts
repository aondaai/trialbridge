import { describe, it, expect } from "vitest";
import { Patient } from "@/lib/matcher/types";
import { evaluatePatient, evaluateCohort, countCohorts } from "@/lib/matcher/engine";
import { softenCriterion, relaxToVariant } from "@/lib/matcher/soften";
import { estimateModeledEligible, KRAS_G12C_PREVALENCE, PDL1_NEGATIVE_ONLY, PDL1_NEGATIVE_OR_LOW } from "@/lib/modeledPrevalence";
import { biomarkerMissingness, evaluateDataset } from "@/lib/service";
import { loadAllSites } from "@/lib/data/sites";
import { NSCLC_CRITERIA, NSCLC_META } from "@/data/nsclc-kras-protocol";

/**
 * Second-scenario suite — proves the engine generalizes to NSCLC/KRAS G12C
 * with zero changes to engine.ts, and exercises the two things that ARE new:
 * `relaxToVariant` (widen, don't drop) and the modeled-prevalence funnel.
 *
 * Deterministic hand-built fixtures (same convention as matcher.test.ts) —
 * independent of scripts/generate-data.ts's random synthetic panel.
 */

function patient(over: Partial<Patient> = {}): Patient {
  const base: Patient = {
    id: "p",
    siteId: "s",
    diagnosis: "lung cancer",
    stage: "IV",
    biomarkers: {
      histology: "nonsquamous",
      kras_g12c: null,
      pdl1_status: null,
      brain_metastases: "absent",
      mi_recent: "absent",
      prior_kras_inhibitor: "absent",
    },
    priorLines: 0,
    ecog: null, // NOT EVALUABLE by construction (see nsclc-kras-protocol.ts)
    labs: {},
    sex: "F",
    age: 60,
  };
  return { ...base, ...over };
}

describe("NSCLC/KRAS G12C protocol fixture", () => {
  it("tags the two gating criteria (and ECOG) as not_evaluable", () => {
    const kras = NSCLC_CRITERIA.find((c) => c.id === "n_kras")!;
    const pdl1 = NSCLC_CRITERIA.find((c) => c.id === "n_pdl1")!;
    const ecog = NSCLC_CRITERIA.find((c) => c.id === "n_ecog")!;
    expect(kras.evaluability).toBe("not_evaluable");
    expect(pdl1.evaluability).toBe("not_evaluable");
    expect(ecog.evaluability).toBe("not_evaluable");
  });

  it("has the PD-L1 gate as the declared hero softening handle (Beat 3)", () => {
    expect(NSCLC_META.heroBottleneckHandle).toBe("pdl1_status");
  });
});

describe("engine generalizes with zero matching-logic changes (D3)", () => {
  it("a fully-untested patient (kras/pdl1/ecog unknown, everything else passing) is POSSIBLE, never DEFINITE", () => {
    const e = evaluatePatient(patient(), NSCLC_CRITERIA);
    expect(e.cohort).toBe("possible");
    expect(e.unknownCriterionIds.sort()).toEqual(["n_ecog", "n_kras", "n_pdl1"].sort());
  });

  it("a fully-tested, fully-qualifying patient is DEFINITE", () => {
    const e = evaluatePatient(
      patient({
        ecog: 0,
        biomarkers: { ...patient().biomarkers, kras_g12c: "positive", pdl1_status: "negative" },
      }),
      NSCLC_CRITERIA,
    );
    expect(e.cohort).toBe("definite");
  });

  it("a patient tested KRAS-negative is genuinely EXCLUDED, not merely possible", () => {
    const e = evaluatePatient(
      patient({ biomarkers: { ...patient().biomarkers, kras_g12c: "negative" } }),
      NSCLC_CRITERIA,
    );
    expect(e.cohort).toBe("excluded");
    expect(e.failedCriterionIds).toContain("n_kras");
  });

  it("stage/histology still gate independently of the molecular unknowns", () => {
    const e = evaluatePatient(patient({ stage: "II" }), NSCLC_CRITERIA);
    expect(e.cohort).toBe("excluded");
    expect(e.failedCriterionIds).toContain("n_stage");
  });
});

describe("softenCriterion (drop) — no single not-evaluable criterion 'fixes' the trial", () => {
  // Every patient is unknown on ALL THREE not-evaluable fields — the sharper
  // honesty point vs. the HER2 scenario (a single bottleneck).
  const cohort: Patient[] = [
    patient({ id: "p1" }),
    patient({ id: "p2" }),
    patient({ id: "p3" }),
  ];

  it("baseline: nobody is definite — all three not-evaluable fields block everyone", () => {
    const counts = countCohorts(evaluateCohort(cohort, NSCLC_CRITERIA));
    expect(counts).toMatchObject({ definite: 0, possible: 3, excluded: 0 });
  });

  it("dropping KRAS alone gains nothing — PD-L1 and ECOG still block", () => {
    const r = softenCriterion(cohort, NSCLC_CRITERIA, "n_kras");
    expect(r.newlyDefinite).toBe(0);
    expect(r.relaxed.possible).toBe(3);
  });

  it("dropping PD-L1 alone gains nothing — KRAS and ECOG still block", () => {
    const r = softenCriterion(cohort, NSCLC_CRITERIA, "n_pdl1");
    expect(r.newlyDefinite).toBe(0);
  });

  it("dropping ECOG alone gains nothing — KRAS and PD-L1 still block", () => {
    const r = softenCriterion(cohort, NSCLC_CRITERIA, "n_ecog");
    expect(r.newlyDefinite).toBe(0);
  });

  it("only dropping ALL THREE not-evaluable criteria reaches definite", () => {
    const withoutAllThree = NSCLC_CRITERIA.filter((c) => !["n_kras", "n_pdl1", "n_ecog"].includes(c.id));
    const counts = countCohorts(evaluateCohort(cohort, withoutAllThree));
    expect(counts.definite).toBe(3);
  });
});

describe("relaxToVariant — widen a value set without dropping the criterion (Beat 3)", () => {
  // Tested-and-would-qualify-if-widened: KRAS positive, PD-L1 tested "low"
  // (fails the negative-only baseline), ECOG known and passing.
  const testedLow = patient({
    id: "tested-low",
    ecog: 1,
    biomarkers: { ...patient().biomarkers, kras_g12c: "positive", pdl1_status: "low" },
  });
  // Genuinely untested on PD-L1 — widening the value set can NEVER resolve this.
  const untested = patient({ id: "untested", ecog: 0, biomarkers: { ...patient().biomarkers, kras_g12c: "positive" } });
  // Tested and would still fail even widened (PD-L1 "high").
  const testedHigh = patient({
    id: "tested-high",
    ecog: 0,
    biomarkers: { ...patient().biomarkers, kras_g12c: "positive", pdl1_status: "high" },
  });
  const cohort = [testedLow, untested, testedHigh];

  it("baseline: only unknowns are possible; the tested-wrong-value patients are excluded", () => {
    const evals = evaluateCohort(cohort, NSCLC_CRITERIA);
    expect(evals.find((e) => e.patientId === "tested-low")!.cohort).toBe("excluded");
    expect(evals.find((e) => e.patientId === "untested")!.cohort).toBe("possible");
    expect(evals.find((e) => e.patientId === "tested-high")!.cohort).toBe("excluded");
  });

  it("widening PD-L1 to negative-or-low flips the TESTED 'low' patient to definite — genuine expansion", () => {
    const r = relaxToVariant(cohort, NSCLC_CRITERIA, "n_pdl1", ["negative", "low"]);
    expect(r.newlyDefiniteFromFail).toBe(1); // tested-low
    expect(r.newlyDefiniteFromUnknown).toBe(0); // widening a value set can never resolve an unknown
    expect(r.relaxed.definite).toBe(1);
  });

  it("contrast: softenCriterion (drop) DOES convert the untested patient too — the caveat bucket", () => {
    const r = softenCriterion(cohort, NSCLC_CRITERIA, "n_pdl1");
    expect(r.newlyDefiniteFromFail).toBe(2); // tested-low AND tested-high both pass once the gate is gone
    expect(r.newlyDefiniteFromUnknown).toBe(1); // the untested patient — the honesty caveat
  });
});

describe("estimateModeledEligible — the addressable-vs-modeled funnel (Beat 3/4)", () => {
  it("both assumption sets are tagged MODELED, never presented as observed", () => {
    const est = estimateModeledEligible({ addressablePool: 1900, assumptions: [KRAS_G12C_PREVALENCE, PDL1_NEGATIVE_ONLY] });
    expect(est.label).toBe("MODELED");
  });

  it("widening PD-L1 negative-only -> negative-or-low roughly doubles the modeled estimate", () => {
    const baseline = estimateModeledEligible({ addressablePool: 1900, assumptions: [KRAS_G12C_PREVALENCE, PDL1_NEGATIVE_ONLY] });
    const widened = estimateModeledEligible({ addressablePool: 1900, assumptions: [KRAS_G12C_PREVALENCE, PDL1_NEGATIVE_OR_LOW] });
    expect(baseline.modeledEligible).toBeGreaterThan(60);
    expect(baseline.modeledEligible).toBeLessThan(90); // ~1900*0.14*0.30 = ~80
    const ratio = widened.modeledEligible / baseline.modeledEligible;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.5); // 0.65/0.30 ≈ 2.17
  });

  it("scales linearly with the addressable pool", () => {
    const small = estimateModeledEligible({ addressablePool: 100, assumptions: [KRAS_G12C_PREVALENCE] });
    const big = estimateModeledEligible({ addressablePool: 1000, assumptions: [KRAS_G12C_PREVALENCE] });
    expect(big.modeledEligible).toBeCloseTo(small.modeledEligible * 10, -1);
  });
});

describe("biomarkerMissingness — the testing-gap stat, against the real generated data", () => {
  it("KRAS/PD-L1 testing gap among lung-cancer patients lands in the designed high-but-not-total range", () => {
    const sites = loadAllSites().map((ds) => evaluateDataset(ds, NSCLC_CRITERIA));
    const kras = biomarkerMissingness(sites, "lung cancer", "kras_g12c");
    const pdl1 = biomarkerMissingness(sites, "lung cancer", "pdl1_status");
    for (const row of [...kras, ...pdl1]) {
      if (row.cohort === 0) continue;
      expect(row.pct).toBeGreaterThan(50); // meaningfully high — the "testing gap"
      expect(row.pct).toBeLessThan(100); // NOT literal-100% — distinct from ECOG's structural gap
    }
  });

  it("ECOG, by construction, is 100% missing for lung-cancer patients — the structural (not probabilistic) gap", () => {
    const sites = loadAllSites();
    for (const ds of sites) {
      const lung = ds.patients.filter((p) => p.diagnosis === "lung cancer");
      const ecogKnown = lung.filter((p) => p.ecog != null);
      expect(ecogKnown.length).toBe(0);
    }
  });
});
