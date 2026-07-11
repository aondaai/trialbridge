/**
 * `cohort.preview` MCP tool handler (ADR-002, phase M0) — the residency boundary.
 *
 * This is the ONLY thing that crosses the site boundary for archetype C: an MCA cloud
 * orchestrator sends `{siteId, criteria}` and receives `{n, perCriterionDelta[], suppressed}`
 * — AGGREGATES ONLY. Patient rows are loaded inside this handler (on the site's own
 * infrastructure), evaluated by the existing matcher via `resolveCohort`, and never enter the
 * response. A defense-in-depth assertion re-checks that no loaded patient id appears in the
 * serialized payload before it leaves the boundary.
 *
 * The handler is transport-agnostic and injectable (`loadPatients`) so it is unit-testable
 * without a DB, and is wrapped by the stdio MCP server (mcp/cohortServer.ts) and by any HTTP
 * surface. No LLM, no patient-level output — by construction.
 */

import { resolveCohort, toCohortPreview, type CohortPreview } from "../resolvers/cohort";
import type { Criterion, Patient } from "@/lib/matcher/types";

export interface CohortPreviewRequest {
  siteId: string;
  criteria: Criterion[];
}

/** How the handler loads a site's patients — injected so tests need no DB. */
export type PatientLoader = (siteId: string) => Promise<Patient[] | null>;

const OPERATORS = new Set([
  "eq", "neq", "lt", "lte", "gt", "gte", "in", "not_in", "exists", "not_exists", "between",
]);

/** Validate an untrusted criteria payload into `Criterion[]`, or throw with a clear reason. */
export function parseCriteriaPayload(raw: unknown): Criterion[] {
  if (!Array.isArray(raw)) throw new Error("criteria must be an array");
  if (raw.length === 0) throw new Error("criteria must be non-empty");
  return raw.map((c, i) => {
    if (typeof c !== "object" || c === null) throw new Error(`criteria[${i}] must be an object`);
    const o = c as Record<string, unknown>;
    if (o.kind !== "inclusion" && o.kind !== "exclusion")
      throw new Error(`criteria[${i}].kind must be inclusion|exclusion`);
    if (typeof o.field !== "string" || !o.field) throw new Error(`criteria[${i}].field required`);
    if (typeof o.operator !== "string" || !OPERATORS.has(o.operator))
      throw new Error(`criteria[${i}].operator invalid`);
    return {
      id: typeof o.id === "string" && o.id ? o.id : `c${i + 1}`,
      kind: o.kind,
      field: o.field,
      operator: o.operator as Criterion["operator"],
      value: (o.value ?? null) as Criterion["value"],
      unit: typeof o.unit === "string" ? o.unit : undefined,
      rawText: typeof o.rawText === "string" ? o.rawText : o.field,
      confidence: typeof o.confidence === "number" ? o.confidence : 1,
      groupId: typeof o.groupId === "string" ? o.groupId : undefined,
      groupLabel: typeof o.groupLabel === "string" ? o.groupLabel : undefined,
    } satisfies Criterion;
  });
}

export class PatientDataLeakError extends Error {
  constructor(id: string) {
    super(`cohort.preview: refusing to return payload — patient id "${id}" leaked into an aggregate response`);
    this.name = "PatientDataLeakError";
  }
}

/**
 * Run a cohort preview for a site. Loads patients (site-side), evaluates via the matcher,
 * and returns aggregates only. Throws `PatientDataLeakError` if — against expectation — any
 * loaded patient id appears in the serialized output (belt-and-suspenders on the boundary).
 */
export async function runCohortPreview(
  req: CohortPreviewRequest,
  loadPatients: PatientLoader,
): Promise<CohortPreview> {
  if (!req.siteId) throw new Error("siteId required");
  const criteria = parseCriteriaPayload(req.criteria);

  const patients = await loadPatients(req.siteId);
  if (!patients) throw new Error(`unknown site "${req.siteId}"`);

  const preview = toCohortPreview(resolveCohort(patients, criteria));

  // Defense-in-depth: no patient identifier may appear as a VALUE in the aggregate payload.
  // Exact leaf-value equality (not substring) — so a numeric MRN like "5" can't false-match
  // inside "15" and reject a legitimate preview, while a genuinely leaked id-as-value is caught.
  // Compare only STRING leaves: Patient.id is a string, aggregate counts are numbers, so an
  // id-as-value leak is a string match — and a numeric count that merely equals a numeric id
  // string ("n":5 vs id "5") is not a leak and must not false-trip the guard.
  const ids = new Set(patients.map((p) => p.id).filter(Boolean));
  for (const leaf of leafValues(preview)) {
    if (typeof leaf === "string" && ids.has(leaf)) throw new PatientDataLeakError(leaf);
  }
  return preview;
}

/** Yield every primitive leaf value of a nested structure (for the leak scan). */
function* leafValues(node: unknown): Generator<string | number | boolean> {
  if (node === null || node === undefined) return;
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) yield* leafValues(v);
  } else if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    yield node;
  }
}

/** The MCP tool descriptor (name + JSON-schema input), shared by the server + docs. */
export const COHORT_PREVIEW_TOOL = {
  name: "cohort.preview",
  description:
    "Evaluate a criteria set against a site's patient population and return AGGREGATE counts only " +
    "(candidate N, per-criterion softening deltas, suppression flag). Never returns patient rows.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      siteId: { type: "string" },
      criteria: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["inclusion", "exclusion"] },
            field: { type: "string" },
            operator: { type: "string", enum: [...OPERATORS] },
            value: {},
            unit: { type: ["string", "null"] },
            rawText: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["kind", "field", "operator"],
        },
      },
    },
    required: ["siteId", "criteria"],
  },
} as const;
