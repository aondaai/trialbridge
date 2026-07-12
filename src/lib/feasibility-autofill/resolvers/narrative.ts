/**
 * Archetype D resolver — narrative / judgment (spec §6.4). The ONLY new LLM surface.
 *
 * Mirrors the parse.ts containment discipline exactly: Claude drafts when ANTHROPIC_API_KEY
 * is set; otherwise a deterministic, grounded template composes a draft from the retrieved
 * exemplars + institution facts so the flow works offline. EITHER WAY the result is
 * `status: "proposed"` and a MODELED, LOW-confidence Metric — the LLM never has submit
 * authority (spec §1 invariant). Approval is a separate human step (F4-3); this resolver
 * cannot return `approved`, by type.
 *
 * The draft is grounded: every clause is expected to trace to a cited exemplar or fact, and
 * the citations travel with the draft so a reviewer can check them.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Confidence, modeled, type Metric } from "@/lib/metric";
import type { RetrievedAnswer } from "../rag";

export interface Citation {
  priorId: string;
  label: string;
}

/** A D draft is ALWAYS proposed — the literal type forbids an approved narrative. */
export interface NarrativeDraft {
  fieldLabel: string;
  draft: string;
  citations: Citation[];
  status: "proposed";
  /** MODELED, LOW confidence — a drafted judgment, never a measured fact. */
  metric: Metric<string | null>;
  source: "claude" | "template";
  note: string;
}

export interface NarrativeContext {
  fieldLabel: string;
  section?: string | null;
  exemplars: RetrievedAnswer[];
  /** Small institution facts the draft may reference, e.g. { anonymization: "pseudonymized" }. */
  institutionFacts?: Record<string, string>;
}

function citationsFor(exemplars: RetrievedAnswer[]): Citation[] {
  return exemplars.map((e) => ({ priorId: e.id, label: e.label }));
}

/** Deterministic offline draft: lead with the closest exemplar, ground in facts, stay hedged. */
function templateDraft(ctx: NarrativeContext): string {
  const top = ctx.exemplars[0];
  const facts = Object.entries(ctx.institutionFacts ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  if (top) {
    return (
      `Com base em respostas anteriores desta instituição para "${top.label}", ` +
      `sugere-se: ${top.answerText}` +
      (facts ? ` (contexto: ${facts}).` : ".") +
      ` [rascunho — revisar e ajustar ao estudo atual antes de aprovar]`
    );
  }
  return (
    `Rascunho não fundamentado por exemplares anteriores para "${ctx.fieldLabel}". ` +
    (facts ? `Contexto institucional: ${facts}. ` : "") +
    `[requer redação humana antes de aprovar]`
  );
}

const SYSTEM_PROMPT = `You draft one answer to a clinical-trial site feasibility questionnaire field, in Brazilian Portuguese, for HUMAN REVIEW. Rules:
- Ground every clause in the provided prior-answer exemplars and institution facts. Do not introduce facts not given.
- Be concise and hedged; this is a draft a coordinator will edit, not a final answer.
- Never state patient counts or invent capabilities. If the exemplars don't support an answer, say a human must complete it.
- Output plain text only.`;

/**
 * Draft a narrative answer. `client` is injectable for tests; when omitted a real
 * Anthropic client is used only if ANTHROPIC_API_KEY is present. Any failure falls back
 * to the grounded template — the flow never breaks, and the output is always `proposed`.
 */
export async function draftNarrative(
  ctx: NarrativeContext,
  client?: Pick<Anthropic, "messages">,
): Promise<NarrativeDraft> {
  const citations = citationsFor(ctx.exemplars);
  const base = {
    fieldLabel: ctx.fieldLabel,
    citations,
    status: "proposed" as const,
  };

  const makeMetric = (text: string) =>
    modeled<string | null>(`narrative.${ctx.fieldLabel}`, text, Confidence.LOW, {
      note: "LLM/template draft — human approval required (never auto-approved)",
    });

  const useLlm = client || process.env.ANTHROPIC_API_KEY;
  if (!useLlm) {
    const draft = templateDraft(ctx);
    return {
      ...base,
      draft,
      metric: makeMetric(draft),
      source: "template",
      note: "ANTHROPIC_API_KEY not set — grounded template draft. Human review required.",
    };
  }

  try {
    const anthropic = client ?? new Anthropic();
    const userContent = JSON.stringify({
      field: ctx.fieldLabel,
      section: ctx.section ?? null,
      exemplars: ctx.exemplars.map((e) => ({ label: e.label, answer: e.answerText })),
      institutionFacts: ctx.institutionFacts ?? {},
    });
    const resp = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text block in response");
    const draft = block.text.trim();
    if (!draft) throw new Error("empty draft");
    return {
      ...base,
      draft,
      metric: makeMetric(draft),
      source: "claude",
      note: `Drafted by ${resp.model}. Proposed only — a coordinator must review and approve.`,
    };
  } catch (err) {
    const draft = templateDraft(ctx);
    return {
      ...base,
      draft,
      metric: makeMetric(draft),
      source: "template",
      note: `Live draft failed (${(err as Error).message}); fell back to a grounded template. Human review required.`,
    };
  }
}
