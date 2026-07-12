/**
 * Kahn data-quality flags (F5-1) — conformance / completeness / plausibility (spec §9).
 *
 * Every answer carries three DQ flags, computed deterministically from the answer value,
 * the archetype, and (for B) the catalog completeness rating. Kahn's framework:
 *   - conformance   — is the value the right shape for its field? (a count is a number;
 *                     availability is yes/no/partial; a text answer is non-empty)
 *   - completeness  — how fully is the underlying data captured? (from CapabilityCatalog
 *                     completeness for B; from Metric confidence otherwise)
 *   - plausibility  — is the value believable? (counts non-negative and within the data
 *                     source size; availability from a known set)
 *
 * Pure and side-effect-free. The DQ badges in the review UI render these directly.
 */

import { Confidence } from "@/lib/metric";
import type { Archetype } from "./fixtures/questionBankLabels";

export type DQFlag = "pass" | "warn" | "fail";

export interface DQFlags {
  conformance: DQFlag;
  completeness: DQFlag;
  plausibility: DQFlag;
}

export interface DQInput {
  archetype: Archetype;
  /** The resolved answer value. */
  value: number | string | null;
  /** Confidence of the answer's Metric. */
  confidence: Confidence;
  /** B only: CapabilityCatalog completeness rating (high|moderate|low). */
  completenessQual?: string | null;
  /** C only: the data source's total patient count, for the plausibility ceiling. */
  dataSourcePatients?: number | null;
}

const AVAILABILITY = new Set(["yes", "no", "partial"]);

function conformance(input: DQInput): DQFlag {
  if (input.value === null) return "fail"; // an unresolved value is non-conformant
  switch (input.archetype) {
    case "C":
      // A count must be a number or the suppression sentinel.
      return typeof input.value === "number" || input.value === "<5" ? "pass" : "fail";
    case "B":
      return AVAILABILITY.has(String(input.value)) ? "pass" : "warn";
    default:
      return String(input.value).trim().length > 0 ? "pass" : "fail";
  }
}

function completeness(input: DQInput): DQFlag {
  if (input.archetype === "B" && input.completenessQual) {
    switch (input.completenessQual.toLowerCase()) {
      case "high":
        return "pass";
      case "low":
        return "fail";
      default:
        return "warn";
    }
  }
  // Fall back to the answer's own confidence.
  switch (input.confidence) {
    case Confidence.HIGH:
      return "pass";
    case Confidence.LOW:
      return "fail";
    default:
      return "warn";
  }
}

function plausibility(input: DQInput): DQFlag {
  if (input.archetype === "C") {
    if (input.value === "<5") return "pass"; // suppressed but valid
    if (typeof input.value !== "number") return "fail";
    if (input.value < 0) return "fail";
    if (input.dataSourcePatients != null && input.value > input.dataSourcePatients) return "fail";
    return "pass";
  }
  if (input.archetype === "B") {
    return input.value === null || AVAILABILITY.has(String(input.value)) ? "pass" : "warn";
  }
  // A/D: a present value is plausible; a null one was already caught by conformance.
  return input.value === null ? "warn" : "pass";
}

/** Compute the three Kahn flags for one answer. */
export function computeDQ(input: DQInput): DQFlags {
  return {
    conformance: conformance(input),
    completeness: completeness(input),
    plausibility: plausibility(input),
  };
}

/** Roll the three flags to a single worst-case badge (fail > warn > pass). */
export function worstFlag(flags: DQFlags): DQFlag {
  const order: DQFlag[] = ["pass", "warn", "fail"];
  return [flags.conformance, flags.completeness, flags.plausibility].reduce((worst, f) =>
    order.indexOf(f) > order.indexOf(worst) ? f : worst,
  );
}
