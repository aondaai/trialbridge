/**
 * FHIR EvidenceVariable adapter — the Phase 2 structured lane.
 *
 * When a sponsor brings machine-readable eligibility (HL7 FHIR — the direction
 * ICH M11 / Vulcan are standardizing on), we do NOT need the LLM to guess at
 * free text: the criteria are already coded. This adapter maps each
 * `characteristic` directly to a typed `Criterion` and returns them as
 * `preParsedCriteria`, so intake skips `parse.ts` and lands straight on the
 * verify table. Higher trust → fewer rows need human correction, but the ones
 * we had to slug from free-text display get a LOWER per-row confidence so they
 * still surface in verification (same mechanic as the LLM path).
 *
 * Handles both the R4-style shape (`definitionCodeableConcept` + `valueX` on the
 * characteristic) and the R5-style `definitionByTypeAndValue`. Accepts a bare
 * EvidenceVariable or a Bundle containing one.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Criterion, Operator } from "@/lib/matcher/types";
import type { IntakeInput, IntakeResult, SourceAdapter } from "../types";

const COMPARATOR: Record<string, Operator> = { "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" };

/** Recognize our canonical patient fields from a concept's text/display/code. */
function fieldFromText(text: string): { field: string; known: boolean } {
  const t = text.toLowerCase();
  const table: [RegExp, string][] = [
    [/\bage\b/, "age"],
    [/ecog|performance status/, "ecog"],
    [/her2/, "her2_status"],
    [/ejection fraction|lvef/, "ejection_fraction"],
    [/creatinine/, "creatinine"],
    [/platelet/, "platelets"],
    [/h[ae]moglobin/, "hemoglobin"],
    [/bilirubin/, "bilirubin"],
    [/brain met/, "brain_metastases"],
    [/prior (lines|therap)/, "prior_lines"],
    [/\bstage\b/, "stage"],
  ];
  for (const [re, field] of table) if (re.test(t)) return { field, known: true };
  const slug = t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return { field: slug || "unknown", known: false };
}

function conceptText(concept: any): string {
  if (!concept) return "";
  if (typeof concept.text === "string") return concept.text;
  const coding = concept.coding?.[0];
  return coding?.display || coding?.code || "";
}

/** From a characteristic (R4 or R5), pull the type concept + the value node. */
function typeAndValue(ch: any): { typeConcept: any; value: any } {
  if (ch.definitionByTypeAndValue) {
    const d = ch.definitionByTypeAndValue;
    return { typeConcept: d.type, value: d };
  }
  return { typeConcept: ch.definitionCodeableConcept, value: ch };
}

interface Mapped {
  operator: Operator;
  value: Criterion["value"];
  unit: string | null;
  /** True when we mapped the value cleanly (drives confidence). */
  clean: boolean;
}

function mapValue(value: any): Mapped {
  if (value?.valueQuantity) {
    const q = value.valueQuantity;
    return {
      operator: COMPARATOR[q.comparator] ?? "eq",
      value: typeof q.value === "number" ? q.value : Number(q.value),
      unit: q.unit ?? q.code ?? null,
      clean: true,
    };
  }
  if (value?.valueRange) {
    const lo = value.valueRange.low ?? {};
    const hi = value.valueRange.high ?? {};
    return { operator: "between", value: [Number(lo.value), Number(hi.value)], unit: lo.unit ?? hi.unit ?? null, clean: true };
  }
  if (value?.valueCodeableConcept) {
    return { operator: "eq", value: conceptText(value.valueCodeableConcept), unit: null, clean: true };
  }
  if (typeof value?.valueBoolean === "boolean") {
    return { operator: value.valueBoolean ? "exists" : "not_exists", value: null, unit: null, clean: true };
  }
  // Nothing we recognized — represent as presence, low confidence.
  return { operator: "exists", value: null, unit: null, clean: false };
}

function findEvidenceVariable(data: any): any | null {
  if (!data || typeof data !== "object") return null;
  if (data.resourceType === "EvidenceVariable") return data;
  if (data.resourceType === "Bundle" && Array.isArray(data.entry)) {
    const hit = data.entry.find((e: any) => e?.resource?.resourceType === "EvidenceVariable");
    return hit?.resource ?? null;
  }
  return null;
}

export const fhirAdapter: SourceAdapter = {
  id: "fhir",

  detect(input) {
    if (input.kind !== "json") return 0;
    return findEvidenceVariable(input.data as any) ? 1 : 0;
  },

  async extract(input): Promise<IntakeResult> {
    if (input.kind !== "json") throw new Error("fhir adapter: expects a json input");
    const ev = findEvidenceVariable(input.data as any);
    if (!ev) throw new Error("fhir adapter: no EvidenceVariable resource found");

    const characteristics: any[] = Array.isArray(ev.characteristic) ? ev.characteristic : [];
    const criteria: Criterion[] = characteristics.map((ch, i) => {
      const { typeConcept, value } = typeAndValue(ch);
      const label = conceptText(typeConcept) || ch.description || "";
      const { field, known } = fieldFromText(label);
      const m = mapValue(value);
      const kind: Criterion["kind"] = ch.exclude ? "exclusion" : "inclusion";
      return {
        id: `c${i + 1}`,
        kind,
        field,
        operator: m.operator,
        value: m.value,
        unit: m.unit ?? undefined,
        rawText: ch.description || `${label} ${m.operator} ${JSON.stringify(m.value)}`.trim(),
        // Clean map of a recognized field = trustworthy; otherwise flag for verify.
        confidence: known && m.clean ? 0.9 : 0.6,
      };
    });

    return {
      metadata: {
        sourceId: ev.id ?? ev.url ?? "fhir-evidence-variable",
        sourceRegistry: "fhir",
        title: ev.title || ev.name || "FHIR EvidenceVariable",
      },
      preParsedCriteria: criteria,
      provenance: {
        adapter: "fhir",
        extraction: "structured",
        trust: "high",
        note: `Mapped ${criteria.length} coded characteristic(s) from a FHIR EvidenceVariable — skipped the LLM parse.`,
      },
    };
  },
};
