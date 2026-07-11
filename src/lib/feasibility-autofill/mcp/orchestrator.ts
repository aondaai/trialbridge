/**
 * Feasibility Autofill orchestrator (ADR-002, phase M1).
 *
 * The routing/assembly logic an MCA cloud agent runs: for each parsed form field, classify →
 * archetype → resolve → assemble a provenanced answer, then gate the whole result. It stitches
 * together the pieces built in F1–F6:
 *   A → resolveProfileByLabel (pure tool)
 *   B → resolveCapability      (pure tool)
 *   C → cohort.preview         (MCP tool to the SITE service — aggregates only, injected)
 *   D → draftNarrative         (LLM agent — injected; always status "proposed")
 *
 * Every I/O dependency (the MCP cohort call, the profile/capability loaders, the narrative
 * LLM) is INJECTED, so the orchestration is deterministic and unit-testable without a live
 * MCA session, a DB, or an API key. In production the MCA agent wires these to the real MCP
 * tool + Prisma + Claude. The orchestrator never sees a patient row (C returns aggregates),
 * never lets D auto-approve, and asserts the provenance gate on assembly.
 */

import { classifyField } from "../classify";
import { resolveProfileByLabel, type ProfileLike } from "../resolvers/profile";
import { resolveCapability, type CapabilityLike } from "../resolvers/capability";
import type { CohortPreview } from "../resolvers/cohort";
import { draftNarrative, type NarrativeContext, type NarrativeDraft } from "../resolvers/narrative";
import { retrievePriorAnswers, type PriorAnswer } from "../rag";
import { Confidence, modeled, assertProvenanced, buildProvenanceIndex, type Metric, type ProvenanceIndex } from "@/lib/metric";
import type { FormFieldDraft } from "../ingest";
import type { Criterion } from "@/lib/matcher/types";
import type { Archetype } from "../fixtures/questionBankLabels";

/** One assembled answer. A/B/C carry a deterministic Metric; D carries the draft's Metric. */
export interface OrchestratedAnswer {
  fieldId: string;
  section: string;
  label: string;
  archetype: Archetype;
  concept: string | null;
  metric: Metric<number | string | null>;
  status: "proposed";
  /** D only: the narrative draft + citations (for the review workspace). */
  narrative?: NarrativeDraft;
}

export interface AutofillRequest {
  siteId: string;
  fields: FormFieldDraft[];
  /** The parsed inclusion/exclusion criteria (drives the single C cohort count). */
  criteria: Criterion[];
}

/** Injected dependencies — the MCA agent wires these to real MCP/DB/Claude. */
export interface OrchestratorDeps {
  loadProfile: (siteId: string) => Promise<ProfileLike | null>;
  loadCapability: (siteId: string, concept: string) => Promise<CapabilityLike | null>;
  /** The cohort.preview MCP tool → aggregates only. */
  cohortPreview: (siteId: string, criteria: Criterion[]) => Promise<CohortPreview>;
  loadPriors: (siteId: string) => Promise<PriorAnswer[]>;
  /** Narrative drafter; defaults to the built-in resolver (Claude/template). */
  draft?: (ctx: NarrativeContext) => Promise<NarrativeDraft>;
  /** Injected timestamp (kept clock-free). */
  asOf?: string;
}

export interface AutofillResult {
  siteId: string;
  answers: OrchestratedAnswer[];
  provenance: ProvenanceIndex;
  /** The shared cohort count for the request (archetype C), if any C field was present. */
  cohort: CohortPreview | null;
}

/**
 * Orchestrate a full-form autofill. Classifies each field, routes to its resolver, and
 * assembles provenanced answers. The C cohort is computed ONCE (via the MCP tool) and shared
 * by all C fields. D answers are always `proposed`. Runs the provenance gate on the assembled
 * metrics before returning.
 */
export async function orchestrateAutofill(
  request: AutofillRequest,
  deps: OrchestratorDeps,
): Promise<AutofillResult> {
  const asOf = deps.asOf ?? null;
  const drafter = deps.draft ?? ((ctx: NarrativeContext) => draftNarrative(ctx));

  const profile = await deps.loadProfile(request.siteId);
  const priors = await deps.loadPriors(request.siteId);

  // Compute the C cohort once, only if some field routes to C.
  const classified = request.fields.map((f) => ({ field: f, cls: classifyField({ section: f.section, label: f.label, cellType: f.cellType }) }));
  const needsCohort = classified.some((c) => c.cls.archetype === "C");
  const cohort = needsCohort ? await deps.cohortPreview(request.siteId, request.criteria) : null;

  const answers: OrchestratedAnswer[] = [];
  for (const { field, cls } of classified) {
    const base = { fieldId: `${field.orderIdx}`, section: field.section, label: field.label, archetype: cls.archetype, concept: cls.concept, status: "proposed" as const };

    if (cls.archetype === "A") {
      const metric = profile
        ? resolveProfileByLabel(profile, field.label, asOf)
        : modeled<string | null>(`profile.${field.label}`, null, Confidence.LOW, { note: "no institution profile on file" });
      answers.push({ ...base, metric });
    } else if (cls.archetype === "B") {
      const row = cls.concept ? await deps.loadCapability(request.siteId, cls.concept) : null;
      const metric = resolveCapability(cls.concept ?? field.label, row, asOf);
      answers.push({ ...base, metric });
    } else if (cls.archetype === "C") {
      const metric = modeled<number | string | null>("cohort.candidates", cohort?.n ?? null, cohort && !cohort.suppressed ? Confidence.HIGH : Confidence.LOW, {
        unit: "patients",
        asOf,
        note: cohort ? (cohort.suppressed ? "suppressed <5" : "from cohort.preview (site MCP tool)") : "no cohort",
      });
      answers.push({ ...base, metric });
    } else {
      // D — narrative. Retrieve exemplars, draft (never approves).
      const exemplars = retrievePriorAnswers({ label: field.label, section: field.section, conceptId: cls.concept }, priors);
      const narrative = await drafter({ fieldLabel: field.label, section: field.section, exemplars, institutionFacts: profile ? { anonimizacao: profile.anonymizationLevel } : {} });
      answers.push({ ...base, metric: narrative.metric, narrative });
    }
  }

  // Provenance gate: every assembled metric must be a well-formed Metric.
  const metrics = answers.map((a) => a.metric);
  assertProvenanced({ metrics });

  return { siteId: request.siteId, answers, provenance: buildProvenanceIndex({ metrics }), cohort };
}
