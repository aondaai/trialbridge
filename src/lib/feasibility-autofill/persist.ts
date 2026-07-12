/**
 * Autofill persistence — write an orchestrator run to FormField/FieldAnswer, and read it back
 * for the review workspace. This is the bridge between the (pure) orchestrator and the DB the
 * UI renders from: the page never runs the pipeline, it reads persisted, provenanced answers.
 *
 * Only the deterministic answer + its provenance/DQ/status live in columns; the D draft and its
 * critique ride in FormField.sourceRef so the reviewer sees what the LLM proposed and how the
 * critic judged it. Re-persisting a request replaces its prior fields (idempotent).
 */

import { prisma } from "@/lib/db";
import { computeDQ, worstFlag, type DQFlags, type DQFlag } from "./dq";
import { isMetric, type Metric } from "@/lib/metric";
import type { AutofillResult } from "./mcp/orchestrator";
import type { Archetype } from "./fixtures/questionBankLabels";

export interface RenderAnswer {
  fieldId: string;
  section: string;
  label: string;
  archetype: Archetype;
  metric: Metric;
  dq: DQFlags;
  dqWorst: DQFlag;
  status: string;
  version: number;
  narrativeDraft?: string;
  critique?: { grounded: boolean; issues: string[] };
}

/** A parsed-but-unanswered field, as produced by intake (ingest). */
export interface IntakeFieldInput {
  section: string;
  label: string;
  cellType: string;
  archetype: Archetype;
  conceptId?: string | null;
  orderIdx: number;
}

/** US-1: persist a request's parsed fields (no answers yet). Replaces any prior fields. */
export async function persistIntakeFields(requestId: string, siteId: string, fields: IntakeFieldInput[]): Promise<void> {
  const prior = await prisma.formField.findMany({ where: { requestId }, select: { id: true } });
  const priorIds = prior.map((f) => f.id);
  if (priorIds.length) {
    await prisma.fieldAnswer.deleteMany({ where: { fieldId: { in: priorIds } } });
    await prisma.formField.deleteMany({ where: { requestId } });
  }
  for (const f of fields) {
    await prisma.formField.create({
      data: { requestId, siteId, section: f.section, label: f.label, cellType: f.cellType, archetype: f.archetype, conceptId: f.conceptId ?? null, orderIdx: f.orderIdx },
    });
  }
}

/**
 * US-2: attach an orchestrator run's answers to a request's fields (matched by orderIdx). Creates
 * a field if one doesn't exist for that index (so the seed can call persistAutofill directly), and
 * updates the field's classified archetype/concept + the D draft/critique in sourceRef.
 */
export async function persistAnswers(requestId: string, siteId: string, result: AutofillResult): Promise<void> {
  const existing = await prisma.formField.findMany({ where: { requestId } });
  const byIdx = new Map(existing.map((f) => [f.orderIdx, f]));

  for (const a of result.answers) {
    const idx = Number(a.fieldId) || 0;
    const dq = computeDQ({ archetype: a.archetype, value: a.metric.value, confidence: a.metric.confidence });
    const sourceRef = JSON.stringify({
      narrativeDraft: a.narrative?.draft ?? null,
      critique: a.critique ? { grounded: a.critique.grounded, issues: a.critique.issues } : null,
    });
    let field = byIdx.get(idx);
    if (!field) {
      field = await prisma.formField.create({
        data: { requestId, siteId, section: a.section, label: a.label, cellType: "text", archetype: a.archetype, conceptId: a.concept ?? null, sourceRef, orderIdx: idx },
      });
    } else {
      await prisma.formField.update({ where: { id: field.id }, data: { archetype: a.archetype, conceptId: a.concept ?? null, sourceRef } });
      await prisma.fieldAnswer.deleteMany({ where: { fieldId: field.id } });
    }
    await prisma.fieldAnswer.create({
      data: {
        fieldId: field.id,
        siteId,
        value: JSON.stringify(a.metric.value ?? null),
        provenance: JSON.stringify(a.metric),
        confidence: a.metric.confidence,
        dqFlags: JSON.stringify({ ...dq, worst: worstFlag(dq) }),
        status: a.status,
      },
    });
  }
}

/** Convenience: persist a full run (fields + answers) — used by the seed and the autofill action. */
export async function persistAutofill(requestId: string, siteId: string, result: AutofillResult): Promise<void> {
  await persistAnswers(requestId, siteId, result);
}

/** Load a request's persisted answers into a render-ready shape, ordered by field. */
export async function loadRenderAnswers(requestId: string): Promise<RenderAnswer[]> {
  const fields = await prisma.formField.findMany({ where: { requestId }, orderBy: { orderIdx: "asc" } });
  if (fields.length === 0) return [];
  const answers = await prisma.fieldAnswer.findMany({ where: { fieldId: { in: fields.map((f) => f.id) } } });
  const byField = new Map(answers.map((a) => [a.fieldId, a]));

  const out: RenderAnswer[] = [];
  for (const f of fields) {
    const a = byField.get(f.id);
    if (!a) continue;
    const metric = safeParse(a.provenance);
    if (!isMetric(metric)) continue;
    const dqRaw = safeParse(a.dqFlags) as Partial<DQFlags & { worst: DQFlag }> | null;
    const dq: DQFlags = {
      conformance: dqRaw?.conformance ?? "warn",
      completeness: dqRaw?.completeness ?? "warn",
      plausibility: dqRaw?.plausibility ?? "warn",
    };
    const ref = safeParse(f.sourceRef ?? "null") as { narrativeDraft?: string | null; critique?: { grounded: boolean; issues: string[] } | null } | null;
    out.push({
      fieldId: a.id,
      section: f.section,
      label: f.label,
      archetype: f.archetype as Archetype,
      metric,
      dq,
      dqWorst: dqRaw?.worst ?? worstFlag(dq),
      status: a.status,
      version: a.version,
      narrativeDraft: ref?.narrativeDraft ?? undefined,
      critique: ref?.critique ?? undefined,
    });
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
