/**
 * Render diff guard (F2-4) — nothing unapproved ships (spec §9, US-5 AC).
 *
 * The renderer must only emit APPROVED answers. This module is the gate between the
 * answer set and the DOCX writer: it splits answers into shippable vs withheld, exposes
 * an approved-vs-proposed diff for the UI (`GET /…/diff`), and hard-asserts before a
 * render that no proposed/edited/rejected answer leaks into the output.
 *
 * Pure and deterministic. `edited` is deliberately NOT shippable — an edited answer must
 * be re-approved (→ `approved`) before it can render. This keeps the LLM's D drafts,
 * which are always `proposed`, out of any shipped document by construction.
 */

export type AnswerStatus = "proposed" | "approved" | "edited" | "rejected";

export interface AnswerRecord {
  fieldId: string;
  label: string;
  /** Rendered string value (already resolved from the Metric). */
  value: string;
  status: AnswerStatus;
}

/** Only fully-approved answers may be rendered. */
export function isShippable(a: AnswerRecord): boolean {
  return a.status === "approved";
}

export interface RenderDiff {
  approved: AnswerRecord[];
  /** Everything held back, with the reason it isn't shipping. */
  withheld: Array<AnswerRecord & { reason: string }>;
  summary: { total: number; approved: number; withheld: number };
}

const WITHHELD_REASON: Record<Exclude<AnswerStatus, "approved">, string> = {
  proposed: "awaiting human review",
  edited: "edited — needs re-approval",
  rejected: "rejected by reviewer",
};

/** Build the approved-vs-proposed diff the export screen shows before download. */
export function buildRenderDiff(answers: AnswerRecord[]): RenderDiff {
  const approved: AnswerRecord[] = [];
  const withheld: Array<AnswerRecord & { reason: string }> = [];
  for (const a of answers) {
    if (isShippable(a)) approved.push(a);
    else withheld.push({ ...a, reason: WITHHELD_REASON[a.status as Exclude<AnswerStatus, "approved">] });
  }
  return {
    approved,
    withheld,
    summary: { total: answers.length, approved: approved.length, withheld: withheld.length },
  };
}

/** Thrown when a render would include a non-approved answer. */
export class UnapprovedContentError extends Error {
  constructor(public readonly offenders: AnswerRecord[]) {
    const ids = offenders.map((o) => `${o.fieldId}(${o.status})`).join(", ");
    super(`Render blocked: ${offenders.length} unapproved answer(s) would ship: ${ids}`);
    this.name = "UnapprovedContentError";
  }
}

/**
 * The gate the renderer calls. Returns the token→value map for APPROVED answers only,
 * after asserting the caller passed no unapproved answer it expected to render. Callers
 * pass the full answer set; withheld answers simply don't appear in the returned values,
 * and their tokens remain unfilled in the document (visible, not silently blanked).
 */
export function approvedRenderValues(answers: AnswerRecord[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const a of answers) if (isShippable(a)) values[a.fieldId] = a.value;
  return values;
}

/**
 * Strict variant: throws `UnapprovedContentError` if ANY answer in the set is not
 * approved. Use when the caller asserts the whole form was signed off (e.g. "submit to
 * sponsor"), vs `approvedRenderValues` which silently withholds (e.g. "draft export").
 */
export function assertAllApproved(answers: AnswerRecord[]): Record<string, string> {
  const offenders = answers.filter((a) => !isShippable(a));
  if (offenders.length > 0) throw new UnapprovedContentError(offenders);
  return approvedRenderValues(answers);
}
