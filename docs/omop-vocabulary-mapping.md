# TrialBridge — OMOP vocabulary mapping ledger

Same discipline as [`citations.md`](./citations.md): this repo doesn't state a
number it can't check. `docs/trialbridge-prd-v4.md`'s OMOP-native matching
engine needs every `Criterion.field` mapped to a real OMOP CDM domain/table
and a standard-vocabulary `concept_id` (SNOMED/LOINC/RxNorm). Real numeric
`concept_id`s come from the OHDSI Athena vocabulary release — not something
safely recalled from memory, the same way the deck's "86%" stat wasn't
safely recalled from a blog post. So `src/lib/omop/vocabulary.ts` ships two
tiers, and this file is the ledger of which is which.

**Verdict key:** ✅ **verified** (checkable, safe to demo as real) · ⏳
**needs mapping** (domain/table/vocabulary family is correct per the OMOP
CDM spec; the numeric `concept_id` is `0` — OMOP's own "unmapped" convention
— until it's run through Athena or a UMLS/BioPortal lookup).

## Verified

| Field | Domain / table | Vocabulary | concept_id | Note |
|---|---|---|---|---|
| `sex` | Person / `person` | Gender | `8507` (MALE) / `8532` (FEMALE) | OMOP's Gender vocabulary is small, stable, and ubiquitous across every OHDSI deployment/tutorial — about as close to "definitely correct" as an OMOP concept_id gets without an Athena lookup. |

## Needs mapping (domain/table/vocabulary correct, concept_id = 0)

| Field | Domain / table | Vocabulary family | Used by |
|---|---|---|---|
| `age` | Person / `person` | — (derived from `birth_datetime`, not concept-coded) | hero, nsclc |
| `diagnosis` | Condition / `condition_occurrence` | SNOMED | hero, nsclc |
| `stage` | Observation / `observation` | SNOMED | hero, nsclc — PRD v4 already flags TNM staging as "not confirmed consistently structured" in the DoctorAssistant Tier 2 dataset |
| `histology` | Observation / `observation` | SNOMED | nsclc |
| `her2_status` | Measurement / `measurement` | LOINC | hero |
| `er_status` | Measurement / `measurement` | LOINC | parser vocabulary |
| `pr_status` | Measurement / `measurement` | LOINC | parser vocabulary |
| `pdl1_status` | Measurement / `measurement` | LOINC | nsclc |
| `kras_g12c` | Measurement / `measurement` | LOINC | nsclc |
| `ecog` | Measurement / `measurement` | LOINC | hero, nsclc |
| `prior_lines` | Drug / `drug_exposure` | RxNorm | hero, nsclc |
| `prior_kras_inhibitor` | Drug / `drug_exposure` | RxNorm | nsclc |
| `brain_metastases` | Condition / `condition_occurrence` | SNOMED | hero, nsclc |
| `mi_recent` | Condition / `condition_occurrence` | SNOMED | nsclc |
| `ejection_fraction` | Measurement / `measurement` | LOINC | hero |
| `creatinine` | Measurement / `measurement` | LOINC | hero |
| `hemoglobin` | Measurement / `measurement` | LOINC | hero |
| `platelets` | Measurement / `measurement` | LOINC | hero |
| `bilirubin` | Measurement / `measurement` | LOINC | hero |

Any `Criterion.field` not in this table at all (a novel field the parser
invents from a new protocol) falls back to `Observation / observation /
vocabularyId: "None" / concept_id: 0` — `src/lib/omop/transform.ts` never
throws on an unmapped field, it just flags it `needsMapping: true`.

## Why exclusion criteria map to `ABSENT`, not a negated concept

`src/lib/omop/transform.ts` derives `assertion` straight from
`Criterion.kind`: `inclusion` → `PRESENT`, `exclusion` → `ABSENT`. This
mirrors the `assertion` field PRD v4 describes on every DoctorAssistant
NLP→OMOP clinical event (`PRESENT` / `HISTORY` / `INVESTIGATION` / `ABSENT` /
`FAMILY_HISTORY` / `OTHER`) — the mechanism that lets a future matcher
evaluate negative criteria ("no prior anti-HER2 ADC") against real notes
instead of silently skipping them, which is the PRD's stated differentiator
against claims-only RWD platforms.

## What "real" mapping work looks like next

1. Run each `conceptName` (already domain/table-correct) through an OHDSI
   Athena search or the equivalent UMLS/BioPortal API to get a real
   `concept_id`, `concept_code`, and standard concept name.
2. Update `FIELD_CONCEPT_MAP` in `src/lib/omop/vocabulary.ts` with the
   result and flip `verified: true`.
3. Move the row from "Needs mapping" to "Verified" in this file, same as a
   citations.md entry graduating from "shaky" to "solid".

## How to activate real mappings (Athena vocabulary bundle)

There is no public, unauthenticated OMOP vocabulary API — `athena.ohdsi.org`'s
search API returns `403` to unauthenticated/non-browser requests, and the
standard OHDSI workflow is downloading a licensed CSV bundle under your own
account, not querying it live. So:

1. Go to [athena.ohdsi.org](https://athena.ohdsi.org), create/sign in to
   your own account, accept the vocabulary license, and download the
   vocabulary bundle (you want at minimum `CONCEPT.csv`; `CONCEPT_SYNONYM.csv`
   improves matching if you include it later).
2. Unzip it and place `CONCEPT.csv` at `trialbridge/data/vocab/CONCEPT.csv`.
   That directory is gitignored — it's large, licensed data, not something
   this repo commits.
3. Run `npm run build-vocab-index`. This reads `CONCEPT.csv` and matches every
   `conceptName` in `FIELD_CONCEPT_MAP` against standard concepts, writing
   `data/vocab-index.json` — a small, committable file (just id/name/vocabulary
   tuples, not the bulk licensed data). Two guardrails keep the committed index
   honest rather than merely populated:
   - **Declared-vocabulary scoping.** A field is resolved only within the
     vocabulary it declares (LOINC/SNOMED/RxNorm/Gender), so the resolved
     `concept_id` can never contradict the Vocabulary column the preview shows
     (no LOINC-row → RxNorm-drug matches).
   - **Exact-only for the committed index.** The deployed build takes only
     verbatim (case-insensitive) name matches. Substring matching still exists
     in `buildVocabIndex.ts` (and is unit-tested) but is opt-in
     (`allowSubstring`) because its guesses need a human glance first — e.g.
     "Hemoglobin" would substring-match the unrelated LOINC concept
     "Hemoglobin casts". Everything not matched exactly keeps the honest
     `needsMapping: true`.

   Against the current Athena release this resolves **2 fields** exactly:
   `ecog` → LOINC `36305384` (ECOG Performance Status score) and
   `ejection_fraction` → LOINC `3027172` (Left ventricular Ejection fraction).
   The rest stay `needsMapping` pending hand-curation (their descriptive names,
   e.g. "HER2 status (IHC/ISH)", don't have a single verbatim standard concept).
4. `src/lib/omop/transform.ts`'s `resolveConcept()` reads
   `data/vocab-index.json` automatically the moment it exists — no other
   code change needed. Re-run step 3 any time you get a newer bundle.
5. **Matching is a heuristic, not a guarantee.** Spot-check a few resolved
   `conceptId`s against Athena's UI before calling them "verified" in a
   pitch — the matcher in `src/lib/omop/buildVocabIndex.ts` does simple
   name matching, not clinical review.

*Generated alongside the CT.gov fetch + OMOP transform layer. Re-verify any
concept_id you promote to "verified" against the live vocabulary — Athena
releases update periodically.*
