/**
 * An in-memory `OmopDataSource` — the only implementation this repo can
 * actually exercise end-to-end without live DataSUS/DoctorAssistant
 * credentials. Used by tests today; also a reasonable seam for a future
 * dev-mode UI toggle once a real adapter exists to compare against.
 */

import type { OmopCriterion, OmopTable } from "../types";
import type { AggregateQueryOptions, AggregateResult, OmopDataSource, OmopPatientEvaluation, RowLevelQueryOptions } from "./types";
import { partitionEvaluable } from "./sql";

export interface MockRecord {
  conceptId: number;
  valueAsNumber?: number;
}

export interface MockPerson {
  personId: string;
  siteId?: string;
  genderConceptId?: number;
  yearOfBirth?: number;
  records: Partial<Record<Exclude<OmopTable, "person">, MockRecord[]>>;
}

function numericMatches(observed: number, operator: OmopCriterion["operator"], value: OmopCriterion["value"]): boolean {
  switch (operator) {
    case "lt":
      return typeof value === "number" && observed < value;
    case "lte":
      return typeof value === "number" && observed <= value;
    case "gt":
      return typeof value === "number" && observed > value;
    case "gte":
      return typeof value === "number" && observed >= value;
    case "between":
      return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" && observed >= value[0] && observed <= value[1];
    default:
      return true; // non-numeric operator on a numeric field: presence alone already established the match
  }
}

/** Does this person have a record satisfying this criterion's concept (+ numeric threshold, if any)? */
function present(person: MockPerson, c: OmopCriterion, currentYear: number): boolean {
  const { concept } = c;

  if (concept.table === "person") {
    if (c.sourceField === "sex") return person.genderConceptId === concept.conceptId;
    if (c.sourceField === "age") {
      if (person.yearOfBirth == null) return false;
      return numericMatches(currentYear - person.yearOfBirth, c.operator, c.value);
    }
    return true;
  }

  const records = person.records[concept.table] ?? [];
  const rec = records.find((r) => r.conceptId === concept.conceptId);
  if (!rec) return false;
  if (concept.table === "measurement" && rec.valueAsNumber !== undefined) {
    return numericMatches(rec.valueAsNumber, c.operator, c.value);
  }
  return true;
}

export class MockOmopDataSource implements OmopDataSource {
  constructor(
    private persons: MockPerson[],
    private currentYear = new Date().getFullYear(),
  ) {}

  async queryAggregate(criteria: OmopCriterion[], _opts?: AggregateQueryOptions): Promise<AggregateResult> {
    const { evaluable, notEvaluable } = partitionEvaluable(criteria);
    const inclusion = evaluable.filter((c) => c.assertion !== "ABSENT");
    const exclusion = evaluable.filter((c) => c.assertion === "ABSENT");

    let definite = 0;
    let excluded = 0;
    for (const person of this.persons) {
      const isExcluded = exclusion.some((c) => present(person, c, this.currentYear));
      if (isExcluded) {
        excluded += 1;
        continue;
      }
      const isDefinite = inclusion.every((c) => present(person, c, this.currentYear));
      if (isDefinite) definite += 1;
    }

    const total = this.persons.length;
    const possible = Math.max(0, total - definite - excluded);
    return { counts: { definite, possible, excluded, total }, notEvaluable };
  }

  async queryRowLevel(criteria: OmopCriterion[], opts: RowLevelQueryOptions): Promise<OmopPatientEvaluation[]> {
    const { evaluable } = partitionEvaluable(criteria);
    const cohort = this.persons.filter((p) => p.siteId === opts.siteId);

    return cohort.map((person) => {
      const results = evaluable.map((c) => {
        const isPresent = present(person, c, this.currentYear);
        const pass = c.assertion === "ABSENT" ? !isPresent : isPresent;
        return {
          criterionId: c.criterionId,
          status: pass ? ("pass" as const) : ("fail" as const),
          matchedConceptId: isPresent ? c.concept.conceptId : null,
        };
      });
      const cohortStatus = results.some((r) => r.status === "fail") ? "excluded" : "definite";
      return { personId: person.personId, cohort: cohortStatus, results };
    });
  }
}
