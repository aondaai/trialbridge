import { describe, it, expect } from "vitest";
import { assemble, AssembleInput } from "@/lib/report/assemble";
import { FunnelSummary, SofteningSummary } from "@/lib/report/types";
import { scoreCountry, brazilCountryInput } from "@/lib/scoring/country";
import { scoreSite, SiteInput } from "@/lib/scoring/site";
import { modeled, peerReviewed, Confidence, ProvenanceGateError, Provenance } from "@/lib/metric";
import { amendmentCost } from "@/lib/constants";

function funnel(): FunnelSummary {
  return {
    scope: "national",
    scopeRef: null,
    basePopulationMetric: modeled("funnel.base", 100000, Confidence.MEDIUM, { unit: "patients" }),
    stages: [
      {
        criterionId: "biomarker",
        label: "KRAS G12C",
        survivalMetric: modeled("funnel.s1.survival", 13, Confidence.MEDIUM, { unit: "%" }),
        remainingPoolMetric: modeled("funnel.s1.remaining", 13000, Confidence.MEDIUM, { unit: "patients" }),
        burdenFlag: true,
      },
    ],
    eligiblePoolMetric: modeled("funnel.eligible", 5000, Confidence.MEDIUM, { unit: "patients" }),
    projectedPatientsPerMonthMetric: modeled("funnel.ppm", 3.2, Confidence.MEDIUM, { unit: "patients/month" }),
  };
}

function softening(): SofteningSummary {
  return {
    scenarios: [
      {
        label: "Relax renal + brain-mets + prior malignancy",
        criteriaRelaxed: ["egfr", "brain_mets", "prior_malignancy"],
        deltaEligiblePoolMetric: modeled("soften.delta_pool", 5000, Confidence.MEDIUM, { unit: "patients" }),
        deltaPatientsPerMonthMetric: modeled("soften.delta_ppm", 3.1, Confidence.MEDIUM, { unit: "patients/month" }),
        amendmentCostAvoidedMetric: amendmentCost("III"),
        scientificRiskNote: "Brain-mets inclusion needs a safety review.",
      },
    ],
  };
}

function siteInput(over: Partial<SiteInput> = {}): SiteInput {
  return {
    cnes: "2077469", name: "ICESP", city: "São Paulo", uf: "SP", profile: "onc_ph3",
    eligiblePool: 220, declaredPool: 200, poolVerifiablePublicly: true,
    projectedPatientsPerMonth: 4, declaredCommitmentPerMonth: 5,
    priorTrials: 5, historicalEnrollmentRate: 2, zeroEnroller: false, hasPIHistory: true,
    competingTrialsInCatchment: 2, requiredEquipment: 6, presentEquipment: 6,
    kolScore0100: 80, projectedFpiDays: 100, inspectionOk: true, declaredQueryRate: 0.3,
    crcCount: 4, crcExperienceYears: 6, emrEsource: true, hasDeclaration: true, hasDigitalSfq: true,
    minInfraFit: 80, cepAccreditedForRisk: true, impLeadTimeDays: 60, daysToFpiBudget: 120,
    screenFailRate: 30, retentionRate: 90, ...over,
  };
}

function input(over: Partial<AssembleInput> = {}): AssembleInput {
  const country = scoreCountry(brazilCountryInput({ nationalEligiblePool: 5000, targetSampleSize: 200 }));
  const sites = [
    scoreSite(siteInput({ cnes: "AAA", name: "Alpha", projectedPatientsPerMonth: 5 })),
    scoreSite(siteInput({ cnes: "BBB", name: "Bravo", projectedPatientsPerMonth: 3 })),
    scoreSite(siteInput({ cnes: "CCC", name: "Charlie", presentEquipment: 2, requiredEquipment: 6 })), // flagged
  ];
  return {
    context: {
      runId: "run_01",
      protocolTitle: "NSCLC KRAS G12C 1L",
      indication: "nsclc.kras_g12c.1l",
      phase: "III",
      sponsor: "DemoBio",
      fxRateBrlUsd: 5.4,
      asOf: "2026-07-10",
    },
    funnel: funnel(),
    softening: softening(),
    country,
    sites,
    ...over,
  };
}

describe("assemble — the 8-section report", () => {
  it("produces all 8 sections and passes the provenance gate", () => {
    const r = assemble(input());
    expect(r.context).toBeDefined(); // meta
    expect(r.decisionSnapshot).toBeDefined(); // §1
    expect(r.funnel).toBeDefined(); // §2
    expect(r.softening).toBeDefined(); // §2
    expect(r.country.dimensions).toHaveLength(7); // §3
    expect(r.siteRankings.length).toBe(3); // §5
    expect(r.siteDeepDives.length).toBe(3); // §6
    expect(r.riskRegister).toBeDefined(); // §8
  });

  it("decision snapshot: top-3 sites ranked, flagged site last, 4 headline metrics", () => {
    const r = assemble(input());
    expect(r.decisionSnapshot.topSites).toHaveLength(3);
    // The flagged Charlie must not lead.
    expect(r.decisionSnapshot.topSites[0].cnes).not.toBe("CCC");
    expect(r.siteRankings[r.siteRankings.length - 1].cnes).toBe("CCC");
    const h = r.decisionSnapshot.headlineMetrics;
    expect(h.projectedPatientsPerMonthMetric.provenance).toBeDefined();
    expect(h.timeToFpiMetric.provenance).toBeDefined();
    expect(h.costPerPatientMetric.provenance).toBeDefined();
    expect(h.riskIndexMetric.provenance).toBeDefined();
  });

  it("risk register aggregates country + site hard flags and builds a provenance index", () => {
    const r = assemble(input());
    expect(r.riskRegister.hardFlags.map((f) => f.key)).toContain("missing_essential_equipment");
    expect(r.riskRegister.provenanceIndex.total).toBeGreaterThan(0);
    // The report mixes modeled + peer-reviewed constants (via country dims) — both should appear.
    expect(r.riskRegister.provenanceIndex.bySeal[Provenance.MODELED]).toBeGreaterThan(0);
    expect(r.riskRegister.assumptions.length).toBeGreaterThan(0);
    expect(r.riskRegister.liveRisksToRecheck.length).toBeGreaterThan(0);
  });

  it("deepDiveN controls how many deep-dive cards are produced", () => {
    const r = assemble(input({ deepDiveN: 1 }));
    expect(r.siteDeepDives).toHaveLength(1);
  });

  it("determinism: same input → identical report", () => {
    expect(assemble(input())).toEqual(assemble(input()));
  });
});

describe("assemble — the provenance gate rejects a bare number in a metric slot", () => {
  it("throws ProvenanceGateError when a funnel stage's survivalMetric is a bare number", () => {
    const bad = input();
    // Corrupt a metric slot with a bare number.
    (bad.funnel.stages[0] as unknown as { survivalMetric: number }).survivalMetric = 13;
    expect(() => assemble(bad)).toThrow(ProvenanceGateError);
  });

  it("a peer-reviewed amendment metric survives the gate (sanity: real Metrics pass)", () => {
    const r = assemble(input());
    const scen = r.softening.scenarios[0];
    expect(scen.amendmentCostAvoidedMetric.provenance).toBe(Provenance.PEER_REVIEWED);
    expect(scen.amendmentCostAvoidedMetric.value).toBe(535000);
  });

  it("a hard flag with an explicit null detailMetric does NOT throw the gate (review #4)", () => {
    const country = scoreCountry(brazilCountryInput({ nationalEligiblePool: 5000, targetSampleSize: 200 }));
    country.hardFlags.push({ key: "adi_7875", label: "ADI 7875 pending", severity: "demote", detailMetric: null });
    expect(() => assemble(input({ country }))).not.toThrow();
  });
});

describe("assemble — review fixes are observable", () => {
  it("provenance index counts each shared Metric ONCE, not per-position (review #1)", () => {
    const r = assemble(input());
    // The decision snapshot re-points at country + site metrics; the total must equal
    // the distinct-metric count, so re-counting can't inflate it.
    const seen = new Set<unknown>();
    let distinct = 0;
    const walk = (v: unknown): void => {
      if (v && typeof v === "object") {
        if ((v as { provenance?: string }).provenance && "value" in (v as object)) {
          if (!seen.has(v)) { seen.add(v); distinct += 1; }
          return;
        }
        if (seen.has(v)) return;
        seen.add(v);
        Object.values(v as Record<string, unknown>).forEach(walk);
      }
    };
    // Walk the same target the assembler indexes (everything except the register).
    walk({ decisionSnapshot: r.decisionSnapshot, funnel: r.funnel, softening: r.softening, country: r.country, siteRankings: r.siteRankings });
    expect(r.riskRegister.provenanceIndex.total).toBe(distinct);
  });

  it("the 'projected enrollment' headline is the NATIONAL funnel rate, not one site's (review #2)", () => {
    const r = assemble(input());
    expect(r.decisionSnapshot.headlineMetrics.projectedPatientsPerMonthMetric).toBe(
      r.funnel.projectedPatientsPerMonthMetric,
    );
  });

  it("the 'time to FPI' headline carries days, not a 0..100 score (review #3)", () => {
    const r = assemble(input());
    expect(r.decisionSnapshot.headlineMetrics.timeToFpiMetric.unit).toBe("days");
  });
});
