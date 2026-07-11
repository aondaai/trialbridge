/**
 * ATLAS / OHDSI cohort-definition JSON adapter — Phase 4 long tail.
 *
 * An ATLAS cohort expression encodes cohort LOGIC (concept sets + primary
 * criteria + inclusion rules), not a flat field/operator/value list. Mapping it
 * to TrialBridge's simple Criterion[] is therefore APPROXIMATE by nature: we
 * turn each named inclusion rule into a presence criterion and surface a best-
 * effort age bound from the demographic criteria. Every mapped row gets LOW
 * confidence so the verify table flags all of it — honest about the lossiness
 * rather than pretending the translation is exact.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Criterion } from "@/lib/matcher/types";
import type { IntakeInput, IntakeResult, SourceAdapter } from "../types";

function isAtlasCohort(data: any): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    Array.isArray(data.ConceptSets) &&
    (Array.isArray(data.InclusionRules) || !!data.PrimaryCriteria)
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "rule";
}

/** Pull a best-effort age criterion from an ATLAS demographic criteria node, if present. */
function ageCriterion(data: any, id: string): Criterion | null {
  const demos: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.DemographicCriteriaList)) demos.push(...node.DemographicCriteriaList);
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  walk(data);
  for (const d of demos) {
    if (d?.Age) {
      const a = d.Age;
      if (typeof a.Value === "number") {
        const op = a.Op === "gte" ? "gte" : a.Op === "gt" ? "gt" : a.Op === "lte" ? "lte" : a.Op === "lt" ? "lt" : "gte";
        return { id, kind: "inclusion", field: "age", operator: op, value: a.Value, unit: "years", rawText: `Age ${op} ${a.Value}`, confidence: 0.6 };
      }
    }
  }
  return null;
}

export const atlasAdapter: SourceAdapter = {
  id: "atlas",

  detect(input) {
    if (input.kind !== "json") return 0;
    return isAtlasCohort(input.data as any) ? 1 : 0;
  },

  async extract(input): Promise<IntakeResult> {
    if (input.kind !== "json") throw new Error("atlas adapter: expects a json input");
    const data = input.data as any;
    if (!isAtlasCohort(data)) throw new Error("atlas adapter: not an ATLAS cohort definition");

    const criteria: Criterion[] = [];
    const age = ageCriterion(data, "c1");
    if (age) criteria.push(age);

    const rules: any[] = Array.isArray(data.InclusionRules) ? data.InclusionRules : [];
    rules.forEach((r, i) => {
      const name: string = r?.name ?? r?.description ?? `inclusion rule ${i + 1}`;
      criteria.push({
        id: `c${criteria.length + 1}`,
        kind: "inclusion",
        field: slug(name),
        // NOT `exists`: the slug field is never in the patient schema, and an
        // `exists` INCLUSION on a missing field resolves to `fail` in the engine
        // → the patient is EXCLUDED. That would classify an entire cohort as
        // excluded from an approximation. `eq` on the same (absent) field
        // resolves to `unknown` → "possible" instead: honest — "couldn't verify
        // this rule against the data" — never a false exclusion.
        operator: "eq",
        value: "yes",
        rawText: name,
        // ATLAS logic → flat criterion is lossy; flag every row for verification.
        confidence: 0.5,
      });
      void i;
    });

    if (criteria.length === 0) {
      criteria.push({
        id: "c1",
        kind: "inclusion",
        field: "primary_cohort_entry_event",
        operator: "eq",
        value: "yes",
        rawText: "ATLAS primary criteria (cohort entry event)",
        confidence: 0.5,
      });
    }

    return {
      metadata: {
        sourceId: input.filename ?? "atlas-cohort",
        sourceRegistry: "atlas",
        title: input.filename ?? "ATLAS cohort definition",
      },
      preParsedCriteria: criteria,
      provenance: {
        adapter: "atlas",
        extraction: "structured",
        trust: "medium",
        note: `Approximated ${criteria.length} criteria from an ATLAS cohort (logic is lossy — verify all rows).`,
      },
    };
  },
};
