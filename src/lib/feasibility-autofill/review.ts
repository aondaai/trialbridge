/**
 * Review / HITL logic (F4-3) — the human-in-the-loop gate.
 *
 * Pure state transitions for the review workspace, with ONE load-bearing invariant:
 * archetype-D (LLM narrative) answers are NEVER auto-approved. Bulk "approve all
 * high-confidence" excludes D by construction; a D answer can only reach `approved`
 * through an explicit, actor-attributed single approve (a human clicking approve).
 *
 * Deterministic and side-effect-free — the route/server-action calls these and persists
 * the result; the invariant is enforced here so it can't be bypassed by the UI.
 */

import type { Archetype } from "./fixtures/questionBankLabels";
import type { AnswerStatus } from "./render/diff";

export interface ReviewAnswer {
  fieldId: string;
  archetype: Archetype;
  status: AnswerStatus;
  confidence: "high" | "medium" | "low";
  reviewerId?: string | null;
  version: number;
}

/**
 * Is this answer eligible for BULK "approve all high-confidence"? Never D, never
 * low/medium confidence, only still-proposed answers. (D and low-confidence are the
 * spec's pre-flagged categories — spec US-3 AC.)
 */
export function eligibleForBulkApprove(a: ReviewAnswer): boolean {
  return a.archetype !== "D" && a.confidence === "high" && a.status === "proposed";
}

/** Thrown if code tries to auto-approve a D answer without a human actor. */
export class NarrativeAutoApproveError extends Error {
  constructor(fieldId: string) {
    super(`Refusing to auto-approve narrative (D) answer "${fieldId}" — requires explicit human approval.`);
    this.name = "NarrativeAutoApproveError";
  }
}

/** Reserved actor names that denote automation, not a human — barred from approving D. */
const AUTOMATED_ACTORS = new Set(["system", "cron", "pipeline", "bot", "llm", "agent", "orchestrator", "mca"]);

function isHumanActor(actor: string): boolean {
  const a = actor.trim().toLowerCase();
  return a.length > 0 && !AUTOMATED_ACTORS.has(a);
}

/**
 * Explicit single approve, always by a named human actor. Works for any archetype
 * INCLUDING D — this is precisely the human sign-off D requires. For D the actor must be a
 * HUMAN: an empty or reserved-automated name (cron/system/agent/…) is refused, so the LLM's
 * own pipeline can never launder a draft to `approved`.
 */
export function approveAnswer(a: ReviewAnswer, actor: string): ReviewAnswer {
  if (a.archetype === "D" && !isHumanActor(actor)) {
    throw new NarrativeAutoApproveError(a.fieldId);
  }
  if (!actor || !actor.trim()) {
    throw new Error(`approveAnswer: an actor is required to approve "${a.fieldId}"`);
  }
  return { ...a, status: "approved", reviewerId: actor, version: a.version + 1 };
}

/** Record a human edit (→ status "edited", needs re-approval before it can ship). */
export function editAnswer(a: ReviewAnswer, actor: string): ReviewAnswer {
  return { ...a, status: "edited", reviewerId: actor || null, version: a.version + 1 };
}

export interface BulkApproveResult {
  approved: ReviewAnswer[];
  /** Left untouched, with why (D, not-high-confidence, or not-proposed). */
  skipped: Array<{ fieldId: string; reason: string }>;
}

/**
 * Bulk "approve all high-confidence". Approves only eligible answers; every D answer is
 * skipped with an explicit reason. `actor` stamps the approvals (still a human action —
 * the coordinator clicking the bulk button).
 */
export function bulkApproveHighConfidence(answers: ReviewAnswer[], actor: string): BulkApproveResult {
  const approved: ReviewAnswer[] = [];
  const skipped: Array<{ fieldId: string; reason: string }> = [];
  for (const a of answers) {
    if (eligibleForBulkApprove(a)) {
      approved.push(approveAnswer(a, actor));
    } else {
      const reason =
        a.archetype === "D"
          ? "narrative (D) — needs individual human review"
          : a.status !== "proposed"
            ? `already ${a.status}`
            : `confidence ${a.confidence}`;
      skipped.push({ fieldId: a.fieldId, reason });
    }
  }
  return { approved, skipped };
}
