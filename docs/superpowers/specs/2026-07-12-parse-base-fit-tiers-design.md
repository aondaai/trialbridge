# Parse base-fit tiers — grounding criterion confidence in the real base

**Date:** 2026-07-12
**Status:** Approved design (pre-implementation)
**Scope:** `trialbridge` web app (sponsor/new parse + verify flow). Web-app-only; no estimator coupling in this spec.

## Problem

On `/sponsor/new`, parsing a real protocol (e.g. NCT06253871, IAM1363 in HER2 cancers)
flags most rows as low-confidence — "18 of 21 flagged." The root cause is not a timid
model: ~12 of those rows are comorbidity/condition criteria dumped into
`diagnosis eq "<English prose>"`, a shape that matches nothing in any real base, so the
parser correctly assigns low confidence.

The confidence column therefore reads as "the parser is unsure," when the real message a
sponsor needs is **"can our data actually check this criterion?"**

An earlier idea — code these to OMOP/CID-10 concepts — is a poor fit: the proprietary base
(6.68M patients / 35 hospitals) is **not OMOP-mapped**, has no reliable structured ICD
(32% coverage, 0–100% by hospital), and is searched via **NLP over clinical text**. Coding
to OMOP fits the wrong target.

## Goal

Parse each criterion into the vocabulary the **real base can actually answer**, and tag it
with a **base-fit tier** so "confidence" becomes grounded in base-answerability. This raises
the confidence column *honestly* (real features earn high confidence; extractable
comorbidities become a clear "add this extraction" path) without inflating genuinely
unanswerable rows.

## The base-fit taxonomy

Every parsed criterion is tagged with one tier, mirroring the estimator's own
`checkable`/`depth` split (`estimator/trialbridge/schema.py`, `protocols.py`):

| Tier | Meaning | Fields / examples | Confidence effect |
|---|---|---|---|
| `checkable` | Answerable from DataSUS aggregates | `dx`, `age`, `sex` | high |
| `depth` | Existing proprietary NLP feature | `her2`, `ecog`, `metastatic`, `stage`, `prior_lines`, `autoimmune` | high |
| `nlp_extractable` | Concept the NLP layer *could* extract from clinical text but doesn't yet; carries a pt-BR phrase set | HIV, hepatite B/C, diabetes, transplante de órgão, doença pulmonar intersticial | medium (~0.6–0.7): "understood, extractable once added" |
| `not_answerable` | Genuinely out of reach from this base | "able to swallow oral medication", labs with no cutoff, nested/temporal logic | low |

**Honesty rule:** rows that are genuinely unspecified in the source (e.g. "adequate organ
function" with no numeric threshold) stay low-confidence regardless of tier. The goal is
grounded confidence, not maximized confidence.

## The feature registry (source of truth)

`src/lib/basefit/registry.ts` is the single source of truth:

- **checkable**: `dx`, `age`, `sex`.
- **depth**: `her2`, `ecog`, `metastatic`, `stage`, `prior_lines`, `autoimmune` — **derived
  from / guarded against** the estimator's real vocabulary so we never claim a feature the
  base doesn't have.
- **nlp_extractable catalog**: a map of `condition_key → { termsPtBr: string[], label }`.
  Seeded with the comorbidities that appear in real oncology protocols (IAM1363 set: HIV,
  hepatitis B/C, diabetes, solid-organ transplant, interstitial lung disease, significant
  cardiac disease), trivially extensible.

The registry is **authoritative for `nlpTerms`**: the LLM proposes a tier + condition key;
`normalize()` reconciles against the registry and stamps the canonical pt-BR phrase set. We
never trust the model to produce correct Brazilian medical terminology.

## Data model

Additive change to `Criterion` (`src/lib/matcher/types.ts`) — nothing existing changes:

```ts
export type BaseFit = "checkable" | "depth" | "nlp_extractable" | "not_answerable";

interface Criterion {
  // …existing fields…
  baseFit?: BaseFit;
  /** nlp_extractable rows only: pt-BR clinical-text phrases the NLP layer would search. */
  nlpTerms?: string[];
}
```

- `field` continues to name the concept per-row (`autoimmune`, `her2_status`, or a condition
  key like `hiv`, `solid_organ_transplant`).
- `baseFit` derives the existing `evaluability` (`checkable`/`depth` → `pass_able`,
  `nlp_extractable` → `partial`, `not_answerable` → `not_evaluable`) so the report layer has
  one coherent signal, not two competing ones.

## Parse changes (`src/lib/parse.ts`)

1. Replace the generic 15-field vocabulary in `SYSTEM_PROMPT` with the registry's tiered
   vocabulary. Instruct the model to prefer a real feature; else classify `nlp_extractable`
   with a condition key; else `not_answerable`. Explicitly forbid dumping comorbidities into
   `diagnosis eq`.
2. Tier-anchor the confidence rubric: `checkable`/`depth` → high unless genuinely ambiguous;
   `nlp_extractable` → ~0.6–0.7; `not_answerable` → low. Unspecified rows stay low.
3. `PARSE_SCHEMA` gains `baseFit` (required enum) + `nlpTerms` (nullable array).
4. `normalize()` validates the tier against the registry, overwrites `nlpTerms` from the
   catalog, and derives `evaluability`.

## UI (`src/app/sponsor/new/page.tsx`)

- Add a **"Base fit"** column to the Step 3 verify table: 🟢 checkable / 🟢 depth /
  🟡 needs NLP (hover reveals the pt-BR phrase set) / ⚪ not answerable.
- Add a companion count to the confidence summary line:
  *"14 of 21 answerable against your base (9 today, 5 via NLP extraction); 7 need review."*
- No change to the matcher engine, the OMOP step (3b), or synthetic patients. `baseFit` is
  descriptive; depth features synthetic patients don't carry resolve `unknown` as today.

## Worked example (IAM1363 / NCT06253871)

| Criterion | Today | After |
|---|---|---|
| Age ≥ 18 | `age gte 18` (0.98) | `checkable`, high |
| ECOG 0–1 | `ecog in [0,1]` (0.97) | `depth`, high |
| LVEF ≥ 50% | `ejection_fraction gte 50` (0.95) | `nlp_extractable` (not an existing depth feature; extractable from echo reports), medium |
| HER2-altered | `her2_status eq "altered"` (0.60) | `depth` (`her2`), high |
| Metastatic (implied) | — | `depth` (`metastatic`), high |
| HIV | `diagnosis eq "HIV-1 or HIV-2 infection"` (0.40) | `nlp_extractable` (`hiv`), medium + pt-BR terms |
| Active hepatitis | `diagnosis eq "…hepatitis A, B, or C"` (0.50) | `nlp_extractable`, medium |
| Solid-organ transplant | `diagnosis eq "…transplantation"` (0.70) | `nlp_extractable`, medium |
| Prior ILD | `diagnosis eq "…interstitial lung disease"` (0.40) | `nlp_extractable`, medium |
| Adequate organ function (Hgb/plt/bili/creat) | `exists null` (0.40) | `not_answerable` (no cutoff in source), stays flagged |
| Able to swallow oral meds | `diagnosis eq "able to swallow…"` (0.50) | `not_answerable`, stays flagged |

**Net: ~12 of 18 flags clear honestly; the rest remain flagged for the right reasons.**

## Testing (vitest, existing `tests/` patterns)

- **Registry guard**: every `depth` feature exists in the estimator's real vocabulary
  (fails if the two drift); catalog entries have non-empty pt-BR terms.
- **`normalize()`**: unknown tier clamped; `nlpTerms` overwritten from catalog;
  `evaluability` derived correctly.
- **Parse fixture (offline, no live key)**: IAM1363 eligibility text → asserted tier
  distribution (`her2`→depth, `hiv`→nlp_extractable, `able_to_swallow`→not_answerable).

## Scope boundaries

**In scope:** registry, `Criterion` fields, parse prompt/schema/normalize, Step 3 UI, tests.

**Out of scope (each a later spec):**
- Estimator bridge (parsed criteria → estimator `checkable`/`depth` schema → real national
  estimate).
- Running actual NLP extraction for `nlp_extractable` concepts.
- Changing synthetic patients or the matcher engine.
- Schema extension for nested/temporal/exception logic (the OR / "within 28 days" /
  exception rows).

## Risks

- **Registry drift from the estimator's real features** → mitigated by the guard test and by
  deriving the `depth` list from `protocols.py`/`schema.py` rather than hand-copying.
- **Over-broad `nlp_extractable` catalog** → keep it seeded to what appears in real
  protocols; extend on demand, not speculatively.
