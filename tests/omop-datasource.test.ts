import { describe, it, expect } from "vitest";
import type { OmopCriterion } from "@/lib/omop/types";
import { partitionEvaluable, buildAggregateSql } from "@/lib/omop/datasource/sql";
import { MockOmopDataSource, type MockPerson } from "@/lib/omop/datasource/mock";

/**
 * Hand-built OmopCriterion fixtures (not routed through toOmopCriteria) so
 * concept_ids are deterministic and under test control — same spirit as
 * tests/matcher.test.ts's hand-built Patient fixtures.
 */
function criterion(over: Partial<OmopCriterion>): OmopCriterion {
  return {
    criterionId: "c",
    sourceField: "field",
    sourceValue: "",
    assertion: "PRESENT",
    operator: "exists",
    value: null,
    unit: null,
    concept: {
      domain: "Observation",
      table: "observation",
      vocabularyId: "None",
      conceptName: "test concept",
      conceptId: 0,
      verified: false,
      needsMapping: true,
    },
    ...over,
  };
}

const AGE_GTE_18 = criterion({
  criterionId: "c_age",
  sourceField: "age",
  assertion: "PRESENT",
  operator: "gte",
  value: 18,
  concept: { domain: "Person", table: "person", vocabularyId: "None", conceptName: "age", conceptId: 0, verified: false, needsMapping: false },
});

const HER2_POSITIVE = criterion({
  criterionId: "c_her2",
  sourceField: "her2_status",
  assertion: "PRESENT",
  operator: "in",
  value: ["positive"],
  concept: { domain: "Measurement", table: "measurement", vocabularyId: "LOINC", conceptName: "HER2 status", conceptId: 555, verified: true, needsMapping: false },
});

const CREATININE_LTE_1_5 = criterion({
  criterionId: "c_creat",
  sourceField: "creatinine",
  assertion: "PRESENT",
  operator: "lte",
  value: 1.5,
  concept: { domain: "Measurement", table: "measurement", vocabularyId: "LOINC", conceptName: "Serum creatinine", conceptId: 777, verified: true, needsMapping: false },
});

const BRAIN_METS_EXCLUDED = criterion({
  criterionId: "c_brain",
  sourceField: "brain_metastases",
  assertion: "ABSENT",
  operator: "eq",
  value: "present",
  concept: { domain: "Condition", table: "condition_occurrence", vocabularyId: "SNOMED", conceptName: "Brain metastases", conceptId: 999, verified: true, needsMapping: false },
});

const UNMAPPED = criterion({ criterionId: "c_unmapped", sourceField: "totally_novel" });

describe("partitionEvaluable", () => {
  it("splits criteria still needsMapping:true from the ones a query can use", () => {
    const { evaluable, notEvaluable } = partitionEvaluable([HER2_POSITIVE, UNMAPPED]);
    expect(evaluable.map((c) => c.criterionId)).toEqual(["c_her2"]);
    expect(notEvaluable).toEqual([
      { criterionId: "c_unmapped", reason: expect.stringContaining("totally_novel") },
    ]);
  });
});

describe("buildAggregateSql", () => {
  it("builds a single-round-trip query with inclusion AND-ed and exclusion OR-ed", () => {
    const sql = buildAggregateSql([AGE_GTE_18, HER2_POSITIVE, BRAIN_METS_EXCLUDED]);
    expect(sql).toContain("COUNT(DISTINCT p.person_id) AS total");
    expect(sql).toContain("AS definite");
    expect(sql).toContain("AS excluded");
    // person-domain age criterion resolves against year_of_birth, not a join
    expect(sql).toContain("EXTRACT(YEAR FROM CURRENT_DATE) - p.year_of_birth");
    // measurement criterion becomes an EXISTS against the measurement table with the right concept_id
    expect(sql).toContain("measurement_concept_id = 555");
    // exclusion criterion's concept_id appears in the excluded/NOT branch
    expect(sql).toContain("condition_concept_id = 999");
    expect(sql).toContain("FROM main.person p");
  });

  it("respects a custom schema", () => {
    const sql = buildAggregateSql([HER2_POSITIVE], "datasus");
    expect(sql).toContain("FROM datasus.person p");
  });

  it("falls back to TRUE/FALSE when one side is empty", () => {
    const onlyInclusion = buildAggregateSql([HER2_POSITIVE]);
    expect(onlyInclusion).toContain("NOT FALSE"); // no exclusion criteria -> exclusion branch is FALSE
  });
});

describe("MockOmopDataSource", () => {
  const persons: MockPerson[] = [
    // Fully matches inclusion, no exclusion -> definite
    {
      personId: "p1",
      siteId: "site-a",
      yearOfBirth: new Date().getFullYear() - 40,
      records: { measurement: [{ conceptId: 555, valueAsNumber: 1 }, { conceptId: 777, valueAsNumber: 1.1 }] },
    },
    // Has the excluding condition -> excluded, regardless of inclusion match
    {
      personId: "p2",
      siteId: "site-a",
      yearOfBirth: new Date().getFullYear() - 50,
      records: {
        measurement: [{ conceptId: 555, valueAsNumber: 1 }, { conceptId: 777, valueAsNumber: 1.1 }],
        condition_occurrence: [{ conceptId: 999 }],
      },
    },
    // Missing the HER2 measurement entirely -> not definite, not excluded -> possible
    {
      personId: "p3",
      siteId: "site-b",
      yearOfBirth: new Date().getFullYear() - 60,
      records: { measurement: [{ conceptId: 777, valueAsNumber: 1.1 }] },
    },
    // Creatinine too high -> fails the numeric threshold -> possible (not excluded, not definite)
    {
      personId: "p4",
      siteId: "site-a",
      yearOfBirth: new Date().getFullYear() - 30,
      records: { measurement: [{ conceptId: 555, valueAsNumber: 1 }, { conceptId: 777, valueAsNumber: 5 }] },
    },
  ];

  it("queryAggregate: definite/excluded/possible/total match hand-worked expectations", async () => {
    const ds = new MockOmopDataSource(persons);
    const { counts, notEvaluable } = await ds.queryAggregate([AGE_GTE_18, HER2_POSITIVE, CREATININE_LTE_1_5, BRAIN_METS_EXCLUDED]);
    expect(notEvaluable).toEqual([]);
    expect(counts).toEqual({ definite: 1, possible: 2, excluded: 1, total: 4 });
  });

  it("queryAggregate: reports needsMapping criteria as notEvaluable instead of silently miscounting", async () => {
    const ds = new MockOmopDataSource(persons);
    const { notEvaluable } = await ds.queryAggregate([HER2_POSITIVE, UNMAPPED]);
    expect(notEvaluable).toHaveLength(1);
    expect(notEvaluable[0].criterionId).toBe("c_unmapped");
  });

  it("queryRowLevel: scopes to one site and returns per-criterion pass/fail with cohort", async () => {
    const ds = new MockOmopDataSource(persons);
    const evals = await ds.queryRowLevel([HER2_POSITIVE, BRAIN_METS_EXCLUDED], { siteId: "site-a" });
    expect(evals.map((e) => e.personId).sort()).toEqual(["p1", "p2", "p4"]); // site-a only, p3 is site-b

    const p1 = evals.find((e) => e.personId === "p1")!;
    expect(p1.cohort).toBe("definite");
    expect(p1.results.every((r) => r.status === "pass")).toBe(true);

    const p2 = evals.find((e) => e.personId === "p2")!;
    expect(p2.cohort).toBe("excluded");
    expect(p2.results.find((r) => r.criterionId === "c_brain")?.status).toBe("fail");
  });
});
