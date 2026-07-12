# Parse base-fit tiers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every parsed criterion with a base-fit tier (checkable / depth / nlp_extractable / not_answerable) so the sponsor/new confidence column reflects what the real proprietary base can actually answer.

**Architecture:** A new `basefit` registry (mirroring the estimator's real feature vocabulary) is the single source of truth. The parse prompt is retargeted onto that vocabulary; `normalize()` reconciles every row against the registry (registry authoritative). The Step 3 UI shows a base-fit badge per row and an "answerable against your base" summary. No estimator coupling, no matcher/engine change.

**Tech Stack:** TypeScript, Next.js (app router), vitest. Parse uses `@anthropic-ai/sdk` (`claude-opus-4-8`).

## Global Constraints

- All new/modified TS must pass `./node_modules/.bin/tsc --noEmit`.
- The registry `depth` list MUST stay in sync with the estimator's real features (`estimator/trialbridge/protocols.py`, `schema.py`) — guarded by a test.
- Registry is authoritative for tier + `nlpTerms`; the LLM's proposal is advisory. Never trust the model to emit pt-BR medical terms.
- Honesty: never inflate confidence on rows the base cannot answer; genuinely-unspecified rows (no numeric cutoff) stay low.
- Spec: `docs/superpowers/specs/2026-07-12-parse-base-fit-tiers-design.md`.

---

## File Structure

- **Create** `src/lib/basefit/registry.ts` — tier type consumers, `CHECKABLE_FIELDS`, `DEPTH_FEATURES`, `NLP_CATALOG`, `reconcileBaseFit`, `evaluabilityFor`, `summarizeBaseFit`.
- **Modify** `src/lib/matcher/types.ts` — add `BaseFit` type; add `baseFit?` + `nlpTerms?` to `Criterion`.
- **Modify** `src/lib/parse.ts` — retarget `SYSTEM_PROMPT`; add `baseFit` to `PARSE_SCHEMA`; export + extend `normalize()`.
- **Modify** `src/app/sponsor/new/page.tsx` — Step 3 "Base fit" column + summary line.
- **Create** `tests/basefit-registry.test.ts` — registry behavior + estimator drift guard.
- **Create** `tests/parse-basefit-normalize.test.ts` — normalize reconciliation over representative IAM1363 rows.

---

## Task 1: Base-fit type + registry

**Files:**
- Modify: `src/lib/matcher/types.ts` (add `BaseFit`, extend `Criterion`)
- Create: `src/lib/basefit/registry.ts`
- Test: `tests/basefit-registry.test.ts`

**Interfaces:**
- Produces: `type BaseFit = "checkable" | "depth" | "nlp_extractable" | "not_answerable"`; `reconcileBaseFit(field: string): { baseFit: BaseFit; nlpTerms?: string[]; evaluability: Evaluability }`; `evaluabilityFor(baseFit: BaseFit): Evaluability`; `summarizeBaseFit(criteria: { baseFit?: BaseFit }[]): { answerableToday: number; viaNlp: number; needReview: number; total: number }`; `CHECKABLE_FIELDS`, `DEPTH_FEATURES`, `NLP_CATALOG`.
- Consumes: `Evaluability` from `src/lib/matcher/types.ts` (existing).

- [ ] **Step 1: Add the `BaseFit` type and Criterion fields**

In `src/lib/matcher/types.ts`, add after the `Evaluability` type definition:

```ts
/** How the real base can answer a criterion. See src/lib/basefit/registry.ts. */
export type BaseFit = "checkable" | "depth" | "nlp_extractable" | "not_answerable";
```

And inside `interface Criterion`, after the `evaluability?` field, add:

```ts
  /** Base-fit tier — which real data source (if any) answers this. */
  baseFit?: BaseFit;
  /** nlp_extractable rows only: pt-BR clinical-text phrases the NLP layer would search. */
  nlpTerms?: string[];
```

- [ ] **Step 2: Write the failing registry test**

Create `tests/basefit-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  reconcileBaseFit,
  evaluabilityFor,
  summarizeBaseFit,
  DEPTH_FEATURES,
  NLP_CATALOG,
} from "@/lib/basefit/registry";

describe("reconcileBaseFit", () => {
  it("classifies checkable fields", () => {
    expect(reconcileBaseFit("age").baseFit).toBe("checkable");
    expect(reconcileBaseFit("sex").baseFit).toBe("checkable");
  });
  it("classifies depth features", () => {
    expect(reconcileBaseFit("her2").baseFit).toBe("depth");
    expect(reconcileBaseFit("autoimmune").baseFit).toBe("depth");
  });
  it("aliases legacy her2_status to the her2 depth feature", () => {
    expect(reconcileBaseFit("her2_status").baseFit).toBe("depth");
  });
  it("classifies catalog concepts as nlp_extractable with pt-BR terms", () => {
    const r = reconcileBaseFit("hiv");
    expect(r.baseFit).toBe("nlp_extractable");
    expect(r.nlpTerms).toContain("HIV");
    expect(r.nlpTerms!.length).toBeGreaterThan(0);
  });
  it("treats unknown fields as not_answerable", () => {
    expect(reconcileBaseFit("able_to_swallow").baseFit).toBe("not_answerable");
    expect(reconcileBaseFit("able_to_swallow").nlpTerms).toBeUndefined();
  });
});

describe("evaluabilityFor", () => {
  it("maps tiers to evaluability", () => {
    expect(evaluabilityFor("checkable")).toBe("pass_able");
    expect(evaluabilityFor("depth")).toBe("pass_able");
    expect(evaluabilityFor("nlp_extractable")).toBe("partial");
    expect(evaluabilityFor("not_answerable")).toBe("not_evaluable");
  });
});

describe("summarizeBaseFit", () => {
  it("counts the three buckets", () => {
    const s = summarizeBaseFit([
      { baseFit: "checkable" }, { baseFit: "depth" },
      { baseFit: "nlp_extractable" }, { baseFit: "not_answerable" }, {},
    ]);
    expect(s).toEqual({ answerableToday: 2, viaNlp: 1, needReview: 2, total: 5 });
  });
});

describe("catalog integrity", () => {
  it("every catalog concept has at least one pt-BR term", () => {
    for (const [key, c] of Object.entries(NLP_CATALOG)) {
      expect(c.termsPtBr.length, key).toBeGreaterThan(0);
    }
  });
});

describe("estimator drift guard", () => {
  it("every depth feature exists in the estimator's real vocabulary", () => {
    const root = resolve(process.cwd(), "estimator", "trialbridge");
    const src =
      readFileSync(join(root, "protocols.py"), "utf8") +
      readFileSync(join(root, "schema.py"), "utf8");
    for (const feature of DEPTH_FEATURES) {
      expect(src, feature).toContain(`"${feature}"`);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/basefit-registry.test.ts`
Expected: FAIL — cannot resolve `@/lib/basefit/registry`.

- [ ] **Step 4: Implement the registry**

Create `src/lib/basefit/registry.ts`:

```ts
/**
 * Base-fit registry — the single source of truth for which criteria the REAL
 * base can answer, and how. `depth` mirrors the estimator's proprietary NLP
 * features (estimator/trialbridge/{protocols,schema}.py); `nlp_extractable`
 * lists concepts the NLP layer could pull from pt-BR clinical text but doesn't
 * yet. See docs/superpowers/specs/2026-07-12-parse-base-fit-tiers-design.md.
 */
import type { BaseFit, Evaluability } from "@/lib/matcher/types";

export const CHECKABLE_FIELDS: ReadonlySet<string> = new Set(["dx", "age", "sex"]);

export const DEPTH_FEATURES: ReadonlySet<string> = new Set([
  "her2", "ecog", "metastatic", "stage", "prior_lines", "autoimmune",
]);

/** Legacy/alternate field names → canonical registry key. */
const ALIASES: Readonly<Record<string, string>> = {
  her2_status: "her2",
  lvef: "ejection_fraction",
};

export interface NlpConcept {
  label: string;
  /** pt-BR clinical-text phrases the NLP layer would search. */
  termsPtBr: string[];
}

export const NLP_CATALOG: Readonly<Record<string, NlpConcept>> = {
  hiv: { label: "HIV infection", termsPtBr: ["HIV", "vírus da imunodeficiência humana", "AIDS", "SIDA"] },
  hepatitis_b: { label: "Hepatitis B", termsPtBr: ["hepatite B", "HBV"] },
  hepatitis_c: { label: "Hepatitis C", termsPtBr: ["hepatite C", "HCV"] },
  active_hepatitis: { label: "Active hepatitis / liver disease", termsPtBr: ["hepatite ativa", "hepatite viral", "doença hepática ativa"] },
  diabetes: { label: "Diabetes", termsPtBr: ["diabetes", "diabetes mellitus", "DM descompensado"] },
  solid_organ_transplant: { label: "Solid organ transplant", termsPtBr: ["transplante de órgão", "transplante de órgão sólido", "transplantado"] },
  interstitial_lung_disease: { label: "Interstitial lung disease", termsPtBr: ["doença pulmonar intersticial", "DPI", "pneumonite intersticial"] },
  significant_cardiac_disease: { label: "Significant cardiac disease", termsPtBr: ["doença cardíaca", "cardiopatia", "insuficiência cardíaca"] },
  ejection_fraction: { label: "LV ejection fraction", termsPtBr: ["fração de ejeção", "FEVE", "fração de ejeção do ventrículo esquerdo"] },
};

export function evaluabilityFor(baseFit: BaseFit): Evaluability {
  switch (baseFit) {
    case "checkable":
    case "depth":
      return "pass_able";
    case "nlp_extractable":
      return "partial";
    case "not_answerable":
      return "not_evaluable";
  }
}

export interface BaseFitResolution {
  baseFit: BaseFit;
  nlpTerms?: string[];
  evaluability: Evaluability;
}

/**
 * Resolve a criterion's `field` to a tier PURELY from registry membership —
 * the registry is authoritative; the model's proposal is advisory. Unknown
 * fields are honestly not_answerable.
 */
export function reconcileBaseFit(field: string): BaseFitResolution {
  const raw = field.trim().toLowerCase();
  const f = ALIASES[raw] ?? raw;
  if (CHECKABLE_FIELDS.has(f)) return { baseFit: "checkable", evaluability: "pass_able" };
  if (DEPTH_FEATURES.has(f)) return { baseFit: "depth", evaluability: "pass_able" };
  const concept = NLP_CATALOG[f];
  if (concept) return { baseFit: "nlp_extractable", nlpTerms: concept.termsPtBr, evaluability: "partial" };
  return { baseFit: "not_answerable", evaluability: "not_evaluable" };
}

export interface BaseFitSummary {
  answerableToday: number; // checkable + depth
  viaNlp: number;          // nlp_extractable
  needReview: number;      // not_answerable or unset
  total: number;
}

export function summarizeBaseFit(criteria: { baseFit?: BaseFit }[]): BaseFitSummary {
  const s: BaseFitSummary = { answerableToday: 0, viaNlp: 0, needReview: 0, total: criteria.length };
  for (const c of criteria) {
    if (c.baseFit === "checkable" || c.baseFit === "depth") s.answerableToday += 1;
    else if (c.baseFit === "nlp_extractable") s.viaNlp += 1;
    else s.needReview += 1;
  }
  return s;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/basefit-registry.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 6: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/matcher/types.ts src/lib/basefit/registry.ts tests/basefit-registry.test.ts
git commit -m "feat(basefit): registry + tier resolution mirroring estimator vocabulary"
```

---

## Task 2: Wire base-fit into the parser

**Files:**
- Modify: `src/lib/parse.ts` (SYSTEM_PROMPT, PARSE_SCHEMA, export + extend `normalize`)
- Test: `tests/parse-basefit-normalize.test.ts`

**Interfaces:**
- Consumes: `reconcileBaseFit` from `src/lib/basefit/registry.ts` (Task 1).
- Produces: exported `normalize(raw: RawCriterion[]): Criterion[]` now stamping `baseFit`, `nlpTerms`, `evaluability`.

- [ ] **Step 1: Write the failing normalize test**

Create `tests/parse-basefit-normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/parse";

// Representative IAM1363 (NCT06253871) parse output — offline, no live key.
const RAW = [
  { kind: "inclusion", field: "age", operator: "gte", value: 18, unit: "years", rawText: "Age >= 18", confidence: 0.98 },
  { kind: "inclusion", field: "her2", operator: "exists", value: null, unit: null, rawText: "HER2-altered", confidence: 0.8 },
  { kind: "inclusion", field: "ecog", operator: "in", value: [0, 1], unit: null, rawText: "ECOG 0-1", confidence: 0.9 },
  { kind: "exclusion", field: "hiv", operator: "exists", value: null, unit: null, rawText: "HIV infection", confidence: 0.7 },
  { kind: "exclusion", field: "solid_organ_transplant", operator: "exists", value: null, unit: null, rawText: "transplant", confidence: 0.7 },
  { kind: "inclusion", field: "able_to_swallow", operator: "exists", value: null, unit: null, rawText: "able to swallow", confidence: 0.5 },
] as const;

describe("normalize stamps base-fit", () => {
  const rows = normalize(RAW as never);
  const by = (f: string) => rows.find((r) => r.field === f)!;

  it("checkable / depth for real features", () => {
    expect(by("age").baseFit).toBe("checkable");
    expect(by("her2").baseFit).toBe("depth");
    expect(by("ecog").baseFit).toBe("depth");
  });
  it("nlp_extractable with pt-BR terms for catalog comorbidities", () => {
    expect(by("hiv").baseFit).toBe("nlp_extractable");
    expect(by("hiv").nlpTerms).toContain("HIV");
    expect(by("solid_organ_transplant").baseFit).toBe("nlp_extractable");
  });
  it("not_answerable for out-of-vocabulary concepts", () => {
    expect(by("able_to_swallow").baseFit).toBe("not_answerable");
    expect(by("able_to_swallow").nlpTerms).toBeUndefined();
  });
  it("derives evaluability from the tier", () => {
    expect(by("age").evaluability).toBe("pass_able");
    expect(by("hiv").evaluability).toBe("partial");
    expect(by("able_to_swallow").evaluability).toBe("not_evaluable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/parse-basefit-normalize.test.ts`
Expected: FAIL — `normalize` is not exported / `baseFit` undefined.

- [ ] **Step 3: Export and extend `normalize`**

In `src/lib/parse.ts`, add the import near the top imports:

```ts
import { reconcileBaseFit } from "@/lib/basefit/registry";
```

Replace the existing `function normalize(...)` (currently at parse.ts:104) with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/parse-basefit-normalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Retarget the parse prompt to the base vocabulary**

In `src/lib/parse.ts`, inside `SYSTEM_PROMPT`, replace the `- "field" is a snake_case patient attribute: ...` bullet with:

```
- "field" is a snake_case attribute from the base's answerable vocabulary. Prefer the most specific:
  · checkable (DataSUS aggregates): age, sex, dx
  · depth (proprietary NLP features): her2, ecog, metastatic, stage, prior_lines, autoimmune
  · nlp_extractable (clinical-text concepts): hiv, hepatitis_b, hepatitis_c, active_hepatitis, diabetes, solid_organ_transplant, interstitial_lung_disease, significant_cardiac_disease, ejection_fraction
  For a named comorbidity, use its nlp_extractable key with exists/not_exists — NEVER dump it into diagnosis eq "<prose>". If nothing fits, use a concise snake_case key for the concept; it will be treated as not-answerable.
```

Replace the `- "confidence" 0..1: LOWER it ...` bullet with:

```
- "confidence" 0..1, anchored to answerability: a checkable/depth feature you expressed cleanly → high (>=0.8); an nlp_extractable concept → ~0.6-0.7; not_answerable, or anything the source leaves unspecified (e.g. "adequate organ function" with no numeric cutoff) → low (<0.5). Never inflate a row the base cannot answer.
```

Add this new bullet immediately after the confidence bullet:

```
- "baseFit" is your tier guess: "checkable" | "depth" | "nlp_extractable" | "not_answerable". The server reconciles it against its registry, so pick the field correctly and the tier follows.
```

- [ ] **Step 6: Add `baseFit` to the structured-output schema**

In `PARSE_SCHEMA.properties`, add after the `confidence` property:

```ts
          baseFit: { type: "string", enum: ["checkable", "depth", "nlp_extractable", "not_answerable"] },
```

And add `"baseFit"` to the `required` array in that same items object (after `"confidence"`).

- [ ] **Step 7: Typecheck + full parse test run**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run tests/parse-basefit-normalize.test.ts tests/basefit-registry.test.ts`
Expected: no type errors; both files PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/parse.ts tests/parse-basefit-normalize.test.ts
git commit -m "feat(parse): retarget vocabulary to base-fit tiers; stamp baseFit in normalize"
```

---

## Task 3: Step 3 UI — base-fit column + summary

**Files:**
- Modify: `src/app/sponsor/new/page.tsx`

**Interfaces:**
- Consumes: `summarizeBaseFit`, `NLP_CATALOG` (unused here), `type BaseFit` from Task 1; `Criterion.baseFit`/`nlpTerms` from Task 1.

- [ ] **Step 1: Import the helper and BaseFit type**

In `src/app/sponsor/new/page.tsx`, add to the imports:

```ts
import { summarizeBaseFit } from "@/lib/basefit/registry";
import type { BaseFit } from "@/lib/matcher/types";
```

- [ ] **Step 2: Add a base-fit badge helper**

Near the bottom of the file, beside `const selStyle`, add:

```tsx
const BASE_FIT_BADGE: Record<BaseFit, { label: string; bg: string; fg: string }> = {
  checkable: { label: "checkable", bg: "rgba(22,163,74,0.12)", fg: "#15803d" },
  depth: { label: "depth", bg: "rgba(22,163,74,0.12)", fg: "#15803d" },
  nlp_extractable: { label: "needs NLP", bg: "rgba(180,83,9,0.14)", fg: "#b45309" },
  not_answerable: { label: "n/a", bg: "var(--panel-2)", fg: "var(--muted, #888)" },
};

function BaseFitBadge({ fit, terms }: { fit?: BaseFit; terms?: string[] }) {
  const s = BASE_FIT_BADGE[fit ?? "not_answerable"];
  const title = fit === "nlp_extractable" && terms?.length ? `NLP terms: ${terms.join(", ")}` : undefined;
  return (
    <span title={title} style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}
```

- [ ] **Step 3: Add the "Base fit" column header**

In the Step 3 table `<thead>`, change the header row from:

```tsx
<th>Kind</th><th>Field</th><th>Op</th><th>Value</th><th>Unit</th><th>Conf.</th><th></th>
```

to:

```tsx
<th>Kind</th><th>Field</th><th>Op</th><th>Value</th><th>Unit</th><th>Base fit</th><th>Conf.</th><th></th>
```

- [ ] **Step 4: Render the badge cell per row**

In the row body, immediately after the unit cell `<td className="mono muted">{r.unit ?? "—"}</td>`, add:

```tsx
                          <td><BaseFitBadge fit={r.baseFit} terms={r.nlpTerms} /></td>
```

- [ ] **Step 5: Add the base-fit summary line**

Inside the flagged-summary IIFE block (the one computing `const flagged = ...`), after the existing `<span>` that reports flagged rows, add a second line. Replace the existing summary `<span style={{ fontSize: 13 }}>...</span>` closing with an added sibling:

```tsx
                    {(() => {
                      const bf = summarizeBaseFit(rows);
                      return (
                        <span style={{ fontSize: 12.5, opacity: 0.85, width: "100%" }}>
                          <strong>{bf.answerableToday + bf.viaNlp} of {bf.total}</strong> answerable against your base
                          ({bf.answerableToday} today, {bf.viaNlp} via NLP extraction); {bf.needReview} need review.
                        </span>
                      );
                    })()}
```

Place it as the last child inside the flex container `div` that wraps the flagged-summary content, so it wraps onto its own line.

- [ ] **Step 6: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual browser verification**

Start dev, open `/sponsor/new`, fetch a real trial (e.g. NCT06253871) and parse it (needs `ANTHROPIC_API_KEY` locally). Verify:
- Each row shows a base-fit badge (green checkable/depth, amber "needs NLP" with a hover tooltip of pt-BR terms, gray n/a).
- The summary reads e.g. "14 of 21 answerable against your base (9 today, 5 via NLP extraction); 7 need review."

Without a key, verify with the two cached fixtures (NCT03529110 / NCT05920356): badges render and the summary counts are consistent with the rows.

- [ ] **Step 8: Commit**

```bash
git add src/app/sponsor/new/page.tsx
git commit -m "feat(sponsor): show base-fit badges + answerability summary in Step 3"
```

---

## Self-Review

**Spec coverage:**
- Taxonomy (4 tiers) → Task 1 registry + Task 2 prompt. ✓
- Feature registry mirrors estimator → Task 1 `DEPTH_FEATURES` + drift-guard test. ✓
- Registry authoritative for `nlpTerms` → Task 2 `normalize` calls `reconcileBaseFit`; model terms not used. ✓
- Data model (`baseFit`, `nlpTerms`, derived `evaluability`) → Task 1 types + Task 2 normalize. ✓
- Parse prompt + grounded confidence + schema → Task 2 steps 5–6. ✓
- UI badges + summary → Task 3. ✓
- Tests (registry guard, normalize, offline fixture) → Tasks 1–2. ✓
- Scope boundaries (no estimator bridge, no engine/patient change) → honored; no such tasks. ✓

**Deviation from spec (intentional):** the spec mentioned `nlpTerms` as a nullable field in `PARSE_SCHEMA`; the plan omits it from the model schema because the registry is fully authoritative for terms (the model needn't emit them). Tier classification is a pure function of `field` membership, so `baseFit` in the schema is advisory only. This is within the spec's "registry authoritative" intent.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `BaseFit` defined in `matcher/types.ts`, consumed by `registry.ts`, `parse.ts`, `page.tsx`. `reconcileBaseFit`/`summarizeBaseFit`/`evaluabilityFor` signatures identical across tasks. `normalize` exported in Task 2, consumed by its test. ✓
