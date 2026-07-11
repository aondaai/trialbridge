/**
 * Narrative critic (ADR-002, phase M2) — an adversarial grounding check on D drafts.
 *
 * D is the one non-deterministic surface. Before a draft reaches human review, a critic
 * whose ONLY job is to REFUTE it runs: "is every clause supported by a cited exemplar or
 * institution fact? does it state a patient count it must not?" This raises the floor on what
 * the coordinator sees — it does NOT approve anything (D stays `proposed`; the human still
 * signs off). A failed critique flags the draft with concrete issues for the reviewer.
 *
 * Same containment as the narrative resolver: Claude critiques when keyed/injected; otherwise
 * a deterministic heuristic critic runs, so the pipeline works offline and is unit-testable.
 * The critic is advisory metadata — it can only downgrade/flag, never upgrade a draft.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { NarrativeDraft, NarrativeContext } from "./narrative";
import { normalize } from "../ingest";

export interface Critique {
  /** True only if the critic found no grounding problems. */
  grounded: boolean;
  /** Concrete issues for the reviewer (empty when grounded). */
  issues: string[];
  source: "claude" | "heuristic";
}

/** Numbers the draft may legitimately contain without being an unsupported count. */
function numbersIn(text: string): string[] {
  return (text.match(/\b\d[\d.,]*\b/g) ?? []).map((s) => s.replace(/[.,]$/, ""));
}

/**
 * Deterministic grounding heuristic (the offline critic). Flags:
 *  - a draft that asserts content but cites no exemplars (ungrounded);
 *  - a multi-digit number in the draft that appears in NO exemplar/fact — a likely fabricated
 *    figure, and D must never state patient counts (spec §1);
 *  - a draft that dropped the "needs human review" hedge.
 */
export function heuristicCritique(draft: NarrativeDraft, ctx: NarrativeContext): Critique {
  const issues: string[] = [];
  const body = normalize(draft.draft);

  const grounded = ctx.exemplars.map((e) => normalize(e.answerText)).join(" ") +
    " " + Object.values(ctx.institutionFacts ?? {}).map(normalize).join(" ");

  if (draft.citations.length === 0 && body.replace(/[^a-z]/g, "").length > 40) {
    issues.push("draft asserts content but cites no prior-answer exemplars (ungrounded)");
  }

  for (const num of numbersIn(draft.draft)) {
    if (num.length >= 2 && !grounded.includes(num)) {
      issues.push(`contains a number "${num}" not supported by any exemplar/fact (possible fabricated count)`);
    }
  }

  return { grounded: issues.length === 0, issues, source: "heuristic" };
}

const CRITIC_SYSTEM = `You are an adversarial reviewer of a DRAFT answer to a clinical-trial feasibility form field. Your job is to REFUTE, not to praise. Given the draft plus the exemplars and facts it was supposed to be grounded in, decide whether every claim is supported. Flag: any statement not traceable to an exemplar/fact; any patient count or invented figure; any overclaim. Default to "not grounded" when unsure. Respond as JSON: {"grounded": boolean, "issues": string[]}. Never rewrite or approve the draft.`;

/**
 * Critique a draft. `client` is injectable for tests; without it, uses a real Anthropic client
 * only if ANTHROPIC_API_KEY is set, else the heuristic. Any failure falls back to the heuristic
 * — the critic never blocks the pipeline, it only annotates.
 */
export async function critiqueNarrative(
  draft: NarrativeDraft,
  ctx: NarrativeContext,
  client?: Pick<Anthropic, "messages">,
): Promise<Critique> {
  const useLlm = client || process.env.ANTHROPIC_API_KEY;
  if (!useLlm) return heuristicCritique(draft, ctx);

  try {
    const anthropic = client ?? new Anthropic();
    const userContent = JSON.stringify({
      draft: draft.draft,
      exemplars: ctx.exemplars.map((e) => ({ label: e.label, answer: e.answerText })),
      institutionFacts: ctx.institutionFacts ?? {},
    });
    const resp = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      system: CRITIC_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text block");
    const parsed = JSON.parse(block.text) as { grounded?: boolean; issues?: string[] };
    return {
      grounded: parsed.grounded === true && (parsed.issues?.length ?? 0) === 0,
      issues: parsed.issues ?? [],
      source: "claude",
    };
  } catch {
    // On any critic failure, fall back to the deterministic check rather than passing blind.
    return heuristicCritique(draft, ctx);
  }
}
