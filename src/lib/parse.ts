/**
 * The parse service — the ONE place Claude is used at runtime.
 *
 * Free-text oncology eligibility → typed, machine-checkable Criterion[]. This is
 * the highest-variance step (ADR: "the risky part is the LLM parse, not the
 * matching"), so it is isolated here and its output is shown back for human
 * verification before it ever reaches the deterministic matcher.
 *
 * Verified fixtures remain the highest-trust offline path. For every other NCT,
 * a conservative deterministic parser preserves each registry criterion and
 * maps only a small set of unambiguous fields. Everything unfamiliar is marked
 * not-answerable/manual-review instead of blocking intake or inventing logic.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Criterion, Operator } from "@/lib/matcher/types";
import { HERO_META, HERO_CRITERIA } from "@/data/hero-protocol";
import { NSCLC_META, NSCLC_CRITERIA } from "@/data/nsclc-kras-protocol";
import { IAM1363_META, IAM1363_CRITERIA } from "@/data/iambic-iam1363-protocol";
import { RELAY_REDEFINE_META, RELAY_REDEFINE_CRITERIA } from "@/data/relay-redefine-protocol";
import { RENTOSERTIB_IPF_META, RENTOSERTIB_IPF_CRITERIA } from "@/data/rentosertib-ipf-protocol";
import { reconcileBaseFit, stampBaseFit } from "@/lib/basefit/registry";

interface CachedFixture {
  nct: string;
  criteria: Criterion[];
  note?: string;
}

const CACHED_FIXTURES: CachedFixture[] = [
  { nct: HERO_META.nct, criteria: HERO_CRITERIA },
  { nct: NSCLC_META.nct, criteria: NSCLC_CRITERIA },
  { nct: IAM1363_META.nct, criteria: IAM1363_CRITERIA },
  {
    nct: RELAY_REDEFINE_META.nct,
    criteria: RELAY_REDEFINE_CRITERIA,
    note: `Loaded the registry-derived offline criteria for ${RELAY_REDEFINE_META.nct}. Review every stage against the current sponsor protocol before building the cohort plan.`,
  },
  {
    nct: RENTOSERTIB_IPF_META.nct,
    criteria: RENTOSERTIB_IPF_CRITERIA,
    note: `Loaded the registry-derived offline criteria for ${RENTOSERTIB_IPF_META.nct}. Review lung-function thresholds, treatment windows, and investigator-judgment rules before building the cohort plan.`,
  },
];

function findCachedFixture(nctId?: string): CachedFixture | undefined {
  if (!nctId) return undefined;
  const id = nctId.trim().toUpperCase();
  return CACHED_FIXTURES.find((f) => f.nct.toUpperCase() === id);
}

export interface ParseResult {
  criteria: Criterion[];
  source: "claude" | "cached" | "deterministic";
  model?: string;
  note: string;
}

const OPERATORS: Operator[] = [
  "eq", "neq", "lt", "lte", "gt", "gte", "in", "not_in", "exists", "not_exists", "between",
];

const SYSTEM_PROMPT = `You convert free-text oncology clinical-trial eligibility criteria into a typed, machine-checkable JSON schema for a DETERMINISTIC matcher. Rules:

- Emit one object per atomic, checkable condition. Split compound sentences.
- "kind" is "inclusion" or "exclusion".
- "field" is a snake_case attribute from the base's answerable vocabulary. Prefer the most specific:
  · checkable (DataSUS aggregates): age, sex, dx
  · depth (proprietary NLP features): her2, ecog, metastatic, autoimmune
  · nlp_extractable (clinical-text concepts): hiv, hepatitis_b, hepatitis_c, active_hepatitis, diabetes, solid_organ_transplant, interstitial_lung_disease, significant_cardiac_disease, ejection_fraction, stage, prior_lines
  For a named comorbidity, use its nlp_extractable key with exists/not_exists — NEVER dump it into diagnosis eq "<prose>". If nothing fits, use a concise snake_case key for the concept; it will be treated as not-answerable.
- "operator" is one of: eq, neq, lt, lte, gt, gte, in, not_in, exists, not_exists, between.
- "value" matches the operator: a number for lt/lte/gt/gte, a 2-element array for between, an array of strings/numbers for in/not_in, a string/number for eq/neq, null for exists/not_exists.
- "unit" is the lab unit (e.g. "mg/dL", "g/dL", "10^9/L", "%") or null.
- "rawText" is the exact source sentence.
- "confidence" 0..1, anchored to answerability: a checkable/depth feature you expressed cleanly → high (>=0.8); an nlp_extractable concept → ~0.6-0.7; not_answerable, or anything the source leaves unspecified (e.g. "adequate organ function" with no numeric cutoff) → low (<0.5). Never inflate a row the base cannot answer.
- "baseFit" is your tier guess: "checkable" | "depth" | "nlp_extractable" | "not_answerable". The server reconciles it against its registry, so pick the field correctly and the tier follows.
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
          baseFit: { type: "string", enum: ["checkable", "depth", "nlp_extractable", "not_answerable"] },
          groupId: { type: ["string", "null"] },
          groupLabel: { type: ["string", "null"] },
        },
        required: ["kind", "field", "operator", "value", "unit", "rawText", "confidence", "baseFit", "groupId", "groupLabel"],
      },
    },
  },
  required: ["criteria"],
} as const;

type RawCriterion = Omit<Criterion, "id"> & { groupId?: string | null; groupLabel?: string | null };

interface SourceCriterion { kind: Criterion["kind"]; rawText: string }

function sourceCriteria(text: string): SourceCriterion[] {
  const rows: SourceCriterion[] = [];
  let kind: Criterion["kind"] | null = null;
  let current: SourceCriterion | null = null;
  let paragraphBreak = true;
  const flush = () => {
    if (current?.rawText) rows.push(current);
    current = null;
  };
  for (const sourceLine of text.replace(/\r/g, "").split("\n")) {
    const line = sourceLine.trim();
    if (!line) { paragraphBreak = true; continue; }
    if (/^(?:key\s+)?inclusion\s+criteria\s*:?$/i.test(line)) {
      flush(); kind = "inclusion"; paragraphBreak = true; continue;
    }
    if (/^(?:key\s+)?exclusion\s+criteria\s*:?$/i.test(line)) {
      flush(); kind = "exclusion"; paragraphBreak = true; continue;
    }
    if (!kind) continue;
    const bullet = line.match(/^(?:[-*•]|\d+(?:\.\d+)*[.)])\s*(.+)$/);
    if (bullet || paragraphBreak || !current) {
      flush();
      current = { kind, rawText: (bullet?.[1] ?? line).trim() };
    } else {
      current.rawText += ` ${line}`;
    }
    paragraphBreak = false;
  }
  flush();
  return rows.slice(0, 500);
}

function deterministicRaw(source: SourceCriterion): RawCriterion {
  const rawText = source.rawText.replace(/\\([<>])/g, "$1");
  const lower = rawText.toLowerCase();
  const base = { kind: source.kind, rawText, confidence: 0.35 } as const;

  const ageBetween = rawText.match(/(?:age|aged)[^\d]{0,12}(\d{1,3})\s*(?:-|to|and)\s*(\d{1,3})/i);
  if (ageBetween) return { ...base, field: "age", operator: "between", value: [Number(ageBetween[1]), Number(ageBetween[2])], unit: "years", confidence: 0.92 };
  const ageMinimum = rawText.match(/(?:age|aged|minimum age)[^\d≥>]{0,16}(?:≥|>=|at least|older than or equal to)?\s*(\d{1,3})\s*(?:years?|yo)?/i);
  if (ageMinimum) return { ...base, field: "age", operator: "gte", value: Number(ageMinimum[1]), unit: "years", confidence: 0.9 };

  if (/\becog\b|eastern cooperative oncology group/i.test(rawText)) {
    const values = [...rawText.matchAll(/\b[0-5]\b/g)].map((match) => Number(match[0]));
    return { ...base, field: "ecog", operator: values.length > 1 ? "in" : "lte", value: values.length > 1 ? [...new Set(values)] : values[0] ?? 1, confidence: 0.9 };
  }

  if (/histolog(?:y|ically)|cytolog(?:y|ically)|\bdiagnosis of\b/i.test(rawText)) {
    const match = rawText.match(/(?:confirmed\s+(?:diagnosis\s+of\s+)?|diagnosis of\s+)(.+?)(?:[.;]|$)/i);
    if (match) return { ...base, field: "diagnosis", operator: "eq", value: match[1].trim().toLowerCase(), confidence: 0.82 };
  }
  if (/\bher2\b/i.test(rawText)) return { ...base, field: "her2_status", operator: "exists", value: null, confidence: 0.72 };
  if (/\bmetastatic\b/i.test(rawText)) return { ...base, field: "metastatic", operator: "exists", value: null, confidence: 0.68 };
  if (/\bautoimmune\b/i.test(rawText)) return { ...base, field: "autoimmune", operator: "exists", value: null, confidence: 0.68 };
  if (/\binterstitial lung disease\b|\bild\b/i.test(rawText)) return { ...base, field: "interstitial_lung_disease", operator: "exists", value: null, confidence: 0.64 };
  if (/\bhiv\b|human immunodeficiency virus/i.test(rawText)) return { ...base, field: "hiv", operator: "exists", value: null, confidence: 0.64 };
  if (/\bhepatitis\b/i.test(rawText)) return { ...base, field: "active_hepatitis", operator: "exists", value: null, confidence: 0.62 };
  if (/\bdiabetes\b/i.test(rawText)) return { ...base, field: "diabetes", operator: "exists", value: null, confidence: 0.62 };
  if (/solid organ transplant|lung transplant/i.test(rawText)) return { ...base, field: "solid_organ_transplant", operator: "exists", value: null, confidence: 0.62 };
  if (/cardiac|cardiovascular/i.test(rawText)) return { ...base, field: "significant_cardiac_disease", operator: "exists", value: null, confidence: 0.6 };
  if (/ejection fraction|\blvef\b/i.test(rawText)) return { ...base, field: "ejection_fraction", operator: "exists", value: null, confidence: 0.6 };
  if (/prior lines?|lines? of (?:systemic )?therapy/i.test(rawText)) return { ...base, field: "prior_lines", operator: "exists", value: null, confidence: 0.58 };
  if (/\bstage\s+[ivx0-9]/i.test(rawText)) return { ...base, field: "stage", operator: "exists", value: null, confidence: 0.58 };

  const label = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "criterion";
  return { ...base, field: `manual_review_${label}`, operator: "exists", value: null };
}

/** NCT-agnostic, fail-open-to-review parser used when live model parsing is unavailable. */
export function parseCriteriaDeterministically(text: string): Criterion[] {
  const extracted = sourceCriteria(text);
  if (!extracted.length) throw new Error("Eligibility text has no recognizable inclusion/exclusion sections.");
  return normalize(extracted.map(deterministicRaw));
}

/** Assign stable ids, clamp confidence, stamp base-fit, drop empty group fields. */
export function normalize(raw: RawCriterion[]): Criterion[] {
  return raw.map((c, i) => {
    const fit = reconcileBaseFit(c.field);
    const out: Criterion = {
      id: `c${i + 1}`,
      kind: c.kind,
      field: c.field,
      operator: c.operator,
      value: c.value,
      unit: c.unit ?? undefined,
      rawText: c.rawText,
      confidence: Math.max(0, Math.min(1, c.confidence ?? 0.5)),
      baseFit: fit.baseFit,
      evaluability: fit.evaluability,
    };
    if (fit.nlpTerms) out.nlpTerms = fit.nlpTerms;
    if (c.groupId) {
      out.groupId = c.groupId;
      out.groupLabel = c.groupLabel ?? c.groupId;
    }
    return out;
  });
}

/**
 * Parse pasted protocol text into Criterion[]. `nctId` should be the NCT id the
 * text actually came from (the ctgov fetch step passes it; a manual edit to the
 * textarea un-trusts it — see sponsor/new/page.tsx). Falls back to the matching
 * cached fixture on no-key/error; otherwise returns a conservative
 * deterministic draft derived only from the supplied text.
 */
export async function parseCriteria(text: string, nctId?: string): Promise<ParseResult> {
  const fixture = findCachedFixture(nctId);

  if (!process.env.ANTHROPIC_API_KEY) {
    if (fixture) return {
      criteria: stampBaseFit(fixture.criteria),
      source: "cached",
      note: fixture.note ?? `Loaded the previously validated eligibility criteria for ${fixture.nct}. Review them before building the cohort plan.`,
    };
    return {
      criteria: parseCriteriaDeterministically(text),
      source: "deterministic",
      note: `Created a conservative review draft${nctId ? ` for ${nctId.trim().toUpperCase()}` : ""} from the supplied eligibility text. Unfamiliar criteria remain manual-review gates; verify every row before posting.`,
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
      note: "Eligibility criteria were extracted from the protocol text. Review flagged items before continuing.",
    };
  } catch (err) {
    if (fixture) return {
      criteria: stampBaseFit(fixture.criteria),
      source: "cached",
      note: fixture.note ?? `Loaded the previously validated eligibility criteria for ${fixture.nct}. Review them before building the cohort plan.`,
    };
    return {
      criteria: parseCriteriaDeterministically(text),
      source: "deterministic",
      note: `Live model parsing was unavailable, so TrialBridge created a conservative review draft${nctId ? ` for ${nctId.trim().toUpperCase()}` : ""}. Unfamiliar criteria remain manual-review gates; verify every row before posting.`,
    };
  }
}
