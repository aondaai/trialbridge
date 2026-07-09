/**
 * The parse service — the ONE place Claude is used at runtime.
 *
 * Free-text oncology eligibility → typed, machine-checkable Criterion[]. This is
 * the highest-variance step (ADR: "the risky part is the LLM parse, not the
 * matching"), so it is isolated here and its output is shown back for human
 * verification before it ever reaches the deterministic matcher.
 *
 * ADR Decision 3B — parse offline, cache, verify: the demo-critical path replays
 * the cached, verified hero criteria. When ANTHROPIC_API_KEY is set, this calls
 * Claude live (shown once, live-but-safe); when it is absent OR the call fails,
 * it falls back to a cached verified artifact — but ONLY for the NCT id that
 * artifact was actually verified against (`nctId` param). The caller (the
 * "0 · Fetch from ClinicalTrials.gov" step) supplies the id it just fetched;
 * a manual edit to the pasted text un-trusts it client-side (see sponsor/new).
 * Without a key AND without a matching cached fixture, this throws rather than
 * silently attaching the wrong trial's criteria to the wrong protocol text —
 * same "nothing honest to fall back to" discipline as ctgov/index.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Criterion, Operator } from "@/lib/matcher/types";
import { HERO_META, HERO_CRITERIA } from "@/data/hero-protocol";
import { NSCLC_META, NSCLC_CRITERIA } from "@/data/nsclc-kras-protocol";

interface CachedFixture {
  nct: string;
  criteria: Criterion[];
}

const CACHED_FIXTURES: CachedFixture[] = [
  { nct: HERO_META.nct, criteria: HERO_CRITERIA },
  { nct: NSCLC_META.nct, criteria: NSCLC_CRITERIA },
];

function findCachedFixture(nctId?: string): CachedFixture | undefined {
  if (!nctId) return undefined;
  const id = nctId.trim().toUpperCase();
  return CACHED_FIXTURES.find((f) => f.nct.toUpperCase() === id);
}

export interface ParseResult {
  criteria: Criterion[];
  source: "claude" | "cached";
  model?: string;
  note: string;
}

const OPERATORS: Operator[] = [
  "eq", "neq", "lt", "lte", "gt", "gte", "in", "not_in", "exists", "not_exists", "between",
];

const SYSTEM_PROMPT = `You convert free-text oncology clinical-trial eligibility criteria into a typed, machine-checkable JSON schema for a DETERMINISTIC matcher. Rules:

- Emit one object per atomic, checkable condition. Split compound sentences.
- "kind" is "inclusion" or "exclusion".
- "field" is a snake_case patient attribute: age, ecog, prior_lines, sex, stage, diagnosis, her2_status, er_status, pr_status, brain_metastases, creatinine, hemoglobin, platelets, bilirubin, ejection_fraction.
- "operator" is one of: eq, neq, lt, lte, gt, gte, in, not_in, exists, not_exists, between.
- "value" matches the operator: a number for lt/lte/gt/gte, a 2-element array for between, an array of strings/numbers for in/not_in, a string/number for eq/neq, null for exists/not_exists.
- "unit" is the lab unit (e.g. "mg/dL", "g/dL", "10^9/L", "%") or null.
- "rawText" is the exact source sentence.
- "confidence" 0..1: LOWER it (<0.75) for anything you cannot express cleanly — temporal logic (">=2 prior lines INCLUDING a platinum"), nested AND/OR, vague clauses ("adequate organ function" as a whole). Represent what you cannot express as your best flat approximation with low confidence rather than dropping it.
- For a composite sentence that expands to several lab thresholds (e.g. "adequate organ function"), set the SAME "groupId" and "groupLabel" on each derived row so the UI can soften them together; otherwise use null for both.
- Never invent criteria not present in the text.`;

/** JSON schema forcing the structured Criterion[] shape (strict structured outputs). */
const PARSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["inclusion", "exclusion"] },
          field: { type: "string" },
          operator: { type: "string", enum: OPERATORS },
          value: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
              { type: "null" },
            ],
          },
          unit: { type: ["string", "null"] },
          rawText: { type: "string" },
          confidence: { type: "number" },
          groupId: { type: ["string", "null"] },
          groupLabel: { type: ["string", "null"] },
        },
        required: ["kind", "field", "operator", "value", "unit", "rawText", "confidence", "groupId", "groupLabel"],
      },
    },
  },
  required: ["criteria"],
} as const;

type RawCriterion = Omit<Criterion, "id"> & { groupId?: string | null; groupLabel?: string | null };

/** Assign stable ids, clamp confidence, and drop empty group fields. */
function normalize(raw: RawCriterion[]): Criterion[] {
  return raw.map((c, i) => {
    const out: Criterion = {
      id: `c${i + 1}`,
      kind: c.kind,
      field: c.field,
      operator: c.operator,
      value: c.value,
      unit: c.unit ?? undefined,
      rawText: c.rawText,
      confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
    };
    if (c.groupId) {
      out.groupId = c.groupId;
      out.groupLabel = c.groupLabel ?? c.groupId;
    }
    return out;
  });
}

const KNOWN_NCTS = CACHED_FIXTURES.map((f) => f.nct).join(", ");

function noFixtureError(nctId: string | undefined, reason: string): Error {
  const which = nctId ? `"${nctId}"` : "this text";
  return new Error(
    `${reason} ${which} isn't one of the verified cached fixtures (${KNOWN_NCTS}), so there is nothing honest to fall back to. Set ANTHROPIC_API_KEY to parse arbitrary protocol text live with Claude, or fetch/paste one of the known trials.`,
  );
}

/**
 * Parse pasted protocol text into Criterion[]. `nctId` should be the NCT id the
 * text actually came from (the ctgov fetch step passes it; a manual edit to the
 * textarea un-trusts it — see sponsor/new/page.tsx). Falls back to the matching
 * cached fixture on no-key/error; throws if no fixture matches rather than
 * attaching an unrelated trial's criteria to this text.
 */
export async function parseCriteria(text: string, nctId?: string): Promise<ParseResult> {
  const fixture = findCachedFixture(nctId);

  if (!process.env.ANTHROPIC_API_KEY) {
    if (!fixture) throw noFixtureError(nctId, "ANTHROPIC_API_KEY not set, and");
    return {
      criteria: fixture.criteria,
      source: "cached",
      note: `ANTHROPIC_API_KEY not set — showing the pre-parsed, human-verified criteria for ${fixture.nct} (ADR Decision 3B: parse offline, cache, verify). Set the key to parse pasted text live with Claude.`,
    };
  }
  try {
    const client = new Anthropic();
    // output_config is newer than the installed SDK's types in some versions — cast.
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
      output_config: { format: { type: "json_schema", schema: PARSE_SCHEMA } },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming);

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no text block in response");
    const parsed = JSON.parse(block.text) as { criteria: RawCriterion[] };
    const criteria = normalize(parsed.criteria);
    if (criteria.length === 0) throw new Error("parser returned zero criteria");
    return {
      criteria,
      source: "claude",
      model: resp.model,
      note: `Parsed live by ${resp.model}. Verify low-confidence rows (flagged) before posting — corrections here are the trust step.`,
    };
  } catch (err) {
    if (!fixture) throw noFixtureError(nctId, `Live parse failed (${(err as Error).message}); fell back would need a cached fixture, but`);
    return {
      criteria: fixture.criteria,
      source: "cached",
      note: `Live parse failed (${(err as Error).message}); fell back to the cached verified ${fixture.nct} criteria so the flow still works.`,
    };
  }
}
