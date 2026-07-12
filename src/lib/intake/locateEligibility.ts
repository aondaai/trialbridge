/**
 * Locate the eligibility section inside a full document.
 *
 * A protocol / IND clinical protocol / CSR is dozens of pages; only the
 * inclusion & exclusion block feeds the matcher. This step narrows a whole
 * document down to that block BEFORE `parse.ts` sees it — so the LLM parse (or
 * the offline cache) works on the right few paragraphs, not a 40-page dump
 * (context rot, and cost).
 *
 * Offline-first: a deterministic heuristic (heading detection + section-end
 * cutoff) runs with no network and no API key, so the whole pipeline and its
 * tests work with nothing configured. When `ANTHROPIC_API_KEY` is set and the
 * caller opts in, Claude does the same job more robustly; on any failure it
 * falls back to the heuristic. Either way the output still flows through the
 * existing verify table — the trust moment is unchanged.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface LocatedEligibility {
  /** The narrowed eligibility text (or the whole input if no section was found). */
  text: string;
  method: "heuristic" | "llm" | "verbatim";
  /** True when an explicit inclusion/eligibility heading was located. */
  found: boolean;
  note: string;
}

/**
 * Headings that mark the START of the eligibility block. The optional prefixes
 * absorb section labels and adjectives seen in real documents AND registries —
 * e.g. the EU CTR download uses "E.3 Principal inclusion criteria" and
 * "E.4 Principal exclusion criteria" (letter/number label + "principal"), which
 * plain "inclusion criteria" heading detection would miss (so the euctr live
 * path used to always fall back to cache).
 */
const LABEL = String.raw`(?:[a-z]?\.?\d[\d.]*\s+)?`; // "E.3 ", "3. ", "4.1.1 "
const ADJ = String.raw`(?:(?:principal|main|key)\s+)?`;

const START_RE = new RegExp(
  `(?:^|\\n)[ \\t>*#\\-]*${LABEL}${ADJ}(inclusion\\s+criteria|eligibility(?:\\s+criteria)?|patient\\s+selection|study\\s+population)\\b`,
  "i",
);

/** The exclusion heading (used to know we've captured both halves). */
const EXCLUSION_RE = new RegExp(`(?:^|\\n)[ \\t>*#\\-]*${LABEL}${ADJ}exclusion\\s+criteria\\b`, "i");

/**
 * Section titles that mean "eligibility is over" — cut the capture here.
 * Guarded so an EXCLUSION bullet that merely starts with one of these words
 * (e.g. "- Treatment with any investigational agent within 28 days") is NOT
 * mistaken for the next section: the line must NOT begin with a bullet marker,
 * and the heading text must be short (≤24 trailing chars before the newline) —
 * a real heading like "Study Design", not a full sentence.
 */
const SECTION_END_RE =
  /\n[ \t]*(?:\d+(?:\.\d+)*\.?\s+)?(?:study\s+design|trial\s+design|treatment\s+plan|interventions?|objectives?|endpoints?|outcome\s+measures?|statistical|sample\s+size|assessments?|schedule\s+of|study\s+procedures?|discontinuation|withdrawal|references?|appendix|investigational\s+plan|dosing\s+and\s+administration|randomi[sz]ation)\b[^\n]{0,24}\n/i;

/** Deterministic, offline eligibility locator. */
export function locateEligibilityHeuristic(fullText: string): LocatedEligibility {
  const start = fullText.match(START_RE);
  if (!start || start.index === undefined) {
    return {
      text: fullText.trim(),
      method: "verbatim",
      found: false,
      note: "No inclusion/eligibility heading found — passing the whole text through for parsing.",
    };
  }
  const startIdx = start.index + (start[0].startsWith("\n") ? 1 : 0);

  // Find where eligibility ends: the first "new section" heading AFTER the
  // exclusion block (so the exclusion list itself isn't cut off).
  const afterStart = fullText.slice(startIdx);
  const exMatch = afterStart.match(EXCLUSION_RE);
  const searchFrom = exMatch && exMatch.index !== undefined ? exMatch.index + exMatch[0].length : 0;
  const endMatch = afterStart.slice(searchFrom).match(SECTION_END_RE);

  const endIdx =
    endMatch && endMatch.index !== undefined ? searchFrom + endMatch.index : afterStart.length;

  const text = afterStart.slice(0, endIdx).trim();
  return {
    text,
    method: "heuristic",
    found: true,
    note: exMatch
      ? "Located inclusion + exclusion block by headings."
      : "Located an eligibility heading (no explicit exclusion section found).",
  };
}

const LLM_SYSTEM = `You are given the full text of a clinical trial document (protocol, synopsis, IND clinical protocol, or CSR). Return ONLY the verbatim eligibility text — the inclusion and exclusion criteria — with nothing added, summarized, or invented. Include both the "Inclusion Criteria" and "Exclusion Criteria" content. If the document contains no eligibility criteria, return the single word: NONE.`;

/**
 * Locate eligibility. Uses Claude when `opts.useLlm` and a key are present;
 * otherwise (and on any LLM error) uses the deterministic heuristic.
 */
export async function locateEligibility(
  fullText: string,
  opts: { useLlm?: boolean } = {},
): Promise<LocatedEligibility> {
  if (!opts.useLlm || !process.env.ANTHROPIC_API_KEY) {
    return locateEligibilityHeuristic(fullText);
  }
  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      system: LLM_SYSTEM,
      messages: [{ role: "user", content: fullText }],
    });
    const block = resp.content.find((b) => b.type === "text");
    const out = block && block.type === "text" ? block.text.trim() : "";
    if (!out || out === "NONE") return locateEligibilityHeuristic(fullText);
    return {
      text: out,
      method: "llm",
      found: true,
      note: `Eligibility section extracted by ${resp.model}.`,
    };
  } catch {
    return locateEligibilityHeuristic(fullText);
  }
}
