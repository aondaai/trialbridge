import { describe, it, expect } from "vitest";
import { Criterion, Patient } from "@/lib/matcher/types";
import { evaluatePatient, evaluateCohort, countCohorts } from "@/lib/matcher/engine";
import { softenCriterion, softenableHandles, rankBottlenecks } from "@/lib/matcher/soften";
import { aggregate, biomarkerSlice, suppress } from "@/lib/matcher/aggregate";
import { canonicalizeLab } from "@/lib/matcher/units";
import { estimateFeasibility } from "@/lib/feasibility";

/**
 * Minimal patient factory — everything present & eligible unless overridden.
 * Spread `over` LAST so an explicit `null` (e.g. { ecog: null }) genuinely
 * overrides the default rather than being swallowed by a `??`.
 */
function patient(over: Partial<Patient> = {}): Patient {
  const base: Patient = {
    id: "p",
    siteId: "s",
    diagnosis: "breast cancer",
    stage: "IV",
    biomarkers: { her2_status: "positive", brain_metastases: "absent" },
    priorLines: 2,
    ecog: 1,
    labs: {
      creatinine: { value: 0.9, unit: "mg/dL" },
      hemoglobin: { value: 12, unit: "g/dL" },
      platelets: { value: 250, unit: "10^9/L" },
      bilirubin: { value: 0.6, unit: "mg/dL" },
      ejection_fraction: { value: 60, unit: "%" },
    },
    sex: "F",
    age: 55,
  };
  return { ...base, ...over };
}

const inc = (id: string, field: string, operator: Criterion["operator"], value: Criterion["value"], unit?: string): Criterion => ({
  id,
  kind: "inclusion",
  field,
  operator,
  value,
  unit,
  rawText: `${field} ${operator} ${JSON.stringify(value)}`,
  confidence: 1,
});

const exc = (id: string, field: string, operator: Criterion["operator"], value: Criterion["value"]): Criterion => ({
  id,
  kind: "exclusion",
  field,
  operator,
  value,
  rawText: `exclude if ${field} ${operator} ${JSON.stringify(value)}`,
  confidence: 1,
});

describe("engine — per-criterion status", () => {
  it("passes an inclusion the patient meets", () => {
    const e = evaluatePatient(patient({ age: 40 }), [inc("a", "age", "gte", 18)]);
    expect(e.results[0].status).toBe("pass");
    expect(e.cohort).toBe("definite");
  });

  it("fails an inclusion the patient violates", () => {
    const e = evaluatePatient(patient({ age: 15 }), [inc("a", "age", "gte", 18)]);
    expect(e.results[0].status).toBe("fail");
    expect(e.cohort).toBe("excluded");
  });

  it("returns unknown when the field is missing (inclusion) — patient is POSSIBLE, not excluded", () => {
    const e = evaluatePatient(patient({ ecog: null }), [inc("a", "ecog", "lte", 1)]);
    expect(e.results[0].status).toBe("unknown");
    expect(e.cohort).toBe("possible");
  });

  it("in / not_in membership", () => {
    const p = patient({ stage: "III" });
    expect(evaluatePatient(p, [inc("a", "stage", "in", ["IV"])]).results[0].status).toBe("fail");
    expect(evaluatePatient(p, [inc("a", "stage", "in", ["III", "IV"])]).results[0].status).toBe("pass");
  });
});

describe("engine — exclusion semantics (D3)", () => {
  it("excludes a patient who HAS the excluding condition", () => {
    const p = patient({ biomarkers: { brain_metastases: "present" } });
    const e = evaluatePatient(p, [exc("x", "brain_metastases", "eq", "present")]);
    expect(e.results[0].status).toBe("fail");
    expect(e.cohort).toBe("excluded");
  });

  it("passes a patient who explicitly does NOT have the excluding condition", () => {
    const p = patient({ biomarkers: { brain_metastases: "absent" } });
    const e = evaluatePatient(p, [exc("x", "brain_metastases", "eq", "present")]);
    expect(e.results[0].status).toBe("pass");
    expect(e.cohort).toBe("definite");
  });

  it("D3: MISSING data on an exclusion is unknown → POSSIBLE, never definite and never excluded", () => {
    const p = patient({ biomarkers: { her2_status: "positive" } }); // brain_metastases absent from map
    const e = evaluatePatient(p, [exc("x", "brain_metastases", "eq", "present")]);
    expect(e.results[0].status).toBe("unknown");
    expect(e.cohort).toBe("possible");
    expect(e.cohort).not.toBe("definite");
  });
});

describe("units — D5 canonicalization", () => {
  it("converts creatinine µmol/L → mg/dL and compares correctly", () => {
    // 88.42 µmol/L ≈ 1.0 mg/dL, under a 1.5 mg/dL ceiling → pass
    const p = patient({ labs: { creatinine: { value: 88.42, unit: "umol/L" } } as Patient["labs"] });
    const e = evaluatePatient(p, [inc("a", "creatinine", "lte", 1.5, "mg/dL")]);
    expect(e.results[0].status).toBe("pass");
  });

  it("a raw-value comparison WITHOUT conversion would have been wrong", () => {
    // 88.42 (µmol/L) compared naively against 1.5 would FAIL; canonicalization saves it.
    const c = canonicalizeLab("creatinine", 88.42, "umol/L");
    expect(c.canonicalized).toBe(true);
    expect(c.value).toBeCloseTo(1.0, 2);
  });

  it("unrecognised unit cannot be reconciled → unknown, never a wrong pass/fail", () => {
    const p = patient({ labs: { creatinine: { value: 5, unit: "mystery" } } as Patient["labs"] });
    const e = evaluatePatient(p, [inc("a", "creatinine", "lte", 1.5, "mg/dL")]);
    expect(e.results[0].status).toBe("unknown");
  });
});

describe("softening — D2 split", () => {
  // Cohort: everyone would be definite except for their HER2 field.
  const criteria = [inc("age", "age", "gte", 18), inc("her2", "her2_status", "in", ["positive"])];
  const cohort: Patient[] = [
    patient({ id: "pos1", biomarkers: { her2_status: "positive" } }),
    patient({ id: "pos2", biomarkers: { her2_status: "positive" } }),
    patient({ id: "neg1", biomarkers: { her2_status: "negative" } }), // FAILS her2 → excluded
    patient({ id: "unk1", biomarkers: {} }), // UNKNOWN her2 → possible
    patient({ id: "unk2", biomarkers: {} }), // UNKNOWN her2 → possible
  ];

  it("baseline cohorts are correct", () => {
    const counts = countCohorts(evaluateCohort(cohort, criteria));
    expect(counts).toMatchObject({ definite: 2, possible: 2, excluded: 1 });
  });

  it("relaxing HER2 splits the gain into fromFail vs fromUnknown (the honesty requirement)", () => {
    const r = softenCriterion(cohort, criteria, "her2");
    // neg1 (was excluded because it FAILED her2) → genuine expansion
    expect(r.newlyDefiniteFromFail).toBe(1);
    // unk1, unk2 (were possible only because her2 was UNKNOWN) → caveat bucket
    expect(r.newlyDefiniteFromUnknown).toBe(2);
    expect(r.newlyDefinite).toBe(3);
    expect(r.relaxed.definite).toBe(5);
  });
});

describe("softening — D4 composite group toggles together", () => {
  const organ: Criterion[] = [
    { ...inc("cr", "creatinine", "lte", 1.5, "mg/dL"), groupId: "organ", groupLabel: "Organ fn" },
    { ...inc("hb", "hemoglobin", "gte", 9, "g/dL"), groupId: "organ", groupLabel: "Organ fn" },
  ];
  const criteria = [inc("age", "age", "gte", 18), ...organ];

  it("exposes one softenable handle for the whole group", () => {
    const handles = softenableHandles(criteria);
    const organHandle = handles.find((h) => h.handle === "organ");
    expect(organHandle).toBeTruthy();
    expect(organHandle!.rawTexts).toHaveLength(2);
  });

  it("relaxing the group removes BOTH lab thresholds at once", () => {
    const p = patient({ labs: { creatinine: { value: 3.0, unit: "mg/dL" }, hemoglobin: { value: 6, unit: "g/dL" } } as Patient["labs"] });
    const before = evaluatePatient(p, criteria);
    expect(before.cohort).toBe("excluded");
    const r = softenCriterion([p], criteria, "organ");
    expect(r.relaxed.definite).toBe(1);
  });
});

describe("aggregate — counts-not-rows + suppression", () => {
  it("suppresses non-zero cells below MIN_CELL to <5", () => {
    expect(suppress(3)).toBe("<5");
    expect(suppress(0)).toBe(0);
    expect(suppress(5)).toBe(5);
    expect(suppress(12)).toBe(12);
  });

  it("aggregates per-site counts without exposing rows", () => {
    const view = aggregate([
      { siteId: "a", siteName: "A", counts: { definite: 10, possible: 5, excluded: 20, total: 35 } },
      { siteId: "b", siteName: "B", counts: { definite: 2, possible: 8, excluded: 5, total: 15 } },
    ]);
    expect(view.perSite[1].definite).toBe("<5"); // site B has 2 → suppressed
    expect(view.totalDefinite).toBe(12);
    expect(view.totalCandidates).toBe(25);
    // structural: no patient array anywhere on the view
    expect(JSON.stringify(view)).not.toContain("patientId");
  });

  it("biomarker slice fires <5 for a rare subgroup", () => {
    const sites = [
      {
        siteId: "a",
        siteName: "A",
        patients: [
          patient({ id: "1", biomarkers: { her2_status: "equivocal" } }),
          patient({ id: "2", biomarkers: { her2_status: "equivocal" } }),
          patient({ id: "3", biomarkers: { her2_status: "equivocal" } }),
          patient({ id: "4", biomarkers: { her2_status: "positive" } }),
        ],
        evals: [] as ReturnType<typeof evaluatePatient>[],
      },
    ];
    sites[0].evals = sites[0].patients.map((p) => evaluatePatient(p, [inc("age", "age", "gte", 18)]));
    const slice = biomarkerSlice(sites, "her2_status", "equivocal");
    expect(slice[0]._rawCandidates).toBe(3);
    expect(slice[0].candidates).toBe("<5"); // visibly suppressed
  });
});

describe("feasibility — R1 funnel + R2 rate", () => {
  it("discounts the screening pool and adds incident flow", () => {
    const est = estimateFeasibility({ definite: 40, possible: 20, monthlyIncidence: 5, months: 6 });
    expect(est.screeningPool).toBe(60);
    expect(est.incidentOverWindow).toBe(30);
    // (60 + 30) * 0.3 = 27
    expect(est.enrollableEstimate).toBe(27);
    // deliverable estimate is far below the raw screening pool — the whole point
    expect(est.enrollableEstimate).toBeLessThan(est.screeningPool);
  });
});

describe("bottleneck ranking", () => {
  it("ranks the pool-limiting criterion first", () => {
    const criteria = [inc("age", "age", "gte", 18), inc("her2", "her2_status", "in", ["positive"])];
    const cohort = [
      patient({ id: "1", biomarkers: { her2_status: "negative" } }),
      patient({ id: "2", biomarkers: { her2_status: "negative" } }),
      patient({ id: "3", biomarkers: { her2_status: "positive" } }),
    ];
    const ranked = rankBottlenecks(cohort, criteria);
    expect(ranked[0].handle).toBe("her2"); // relaxing HER2 frees the most patients
  });
});
