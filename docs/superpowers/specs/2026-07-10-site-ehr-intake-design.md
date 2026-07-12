# Site-side EHR intake — design

**Date:** 2026-07-10
**Status:** approved for planning
**Mirrors:** the sponsor-side universal intake (`src/lib/intake/`) — this is its twin.

## Goal

Let a site coordinator (Camila) bring **raw EHR data** and have TrialBridge structure it into
the matcher's `Patient[]` shape — instead of hand-authoring clean `Patient` JSON as today. Demo
hero is **CSV / Excel export** ("export from your EMR"). FHIR / OMOP / on-prem NLP are the roadmap.

## Context (current state)

- `Patient` (`src/lib/matcher/types.ts`): `id, siteId, diagnosis, stage, biomarkers{}, priorLines,
  ecog, labs{value,unit}, sex, age`. `biomarkers`/`labs` are open maps; **`null`/missing is
  first-class → the matcher returns `unknown` → cohort "possible"** (decision D3). Imperfect
  structuring therefore degrades *safely* — it never produces a silent wrong match.
- `/site/new` today: a form (name/city/region/monthlyIncidence) + a textarea where Camila pastes a
  JSON array **already in `Patient` shape**; `site/new/parse.ts::parsePatientsJson` only *validates*
  that shape, then `actions.ts::listSite` calls `upsertSite` + `replacePatients` and redirects to
  `/site`.
- `/site`: `service.evaluateDataset` runs the matcher privately over the site's patients → tri-state
  counts; the sponsor only ever sees aggregates.
- Reusable assets already in the repo: the dependency-free **XLSX/zip reader**
  (`src/lib/intake/envelope/{zip,index}.ts`, `xlsxRows`), **unit canonicalization**
  (`src/lib/matcher/units.ts`), and the sponsor intake's **provenance/trust** UI vocabulary.

## Decisions (from brainstorming)

1. Demo hero input = **CSV/XLSX** (one row per patient).
2. Structuring strategy = **heuristic auto-map → interactive mapping-and-verify UI**; an LLM
   column/value mapper is an *optional upgrade*, not the centerpiece.
3. **Fully replace** the "paste exact Patient JSON" path (no advanced fallback).
4. Ship a **realistic messy sample CSV** generated from the existing synthetic site data.

## Architecture

A `PatientSourceAdapter` registry that parallels the sponsor `SourceAdapter` registry, living in a
new **`src/lib/patient-intake/`**:

```ts
interface PatientSourceInput  // { kind: "text"; text } | { kind: "file"; filename; bytes }
interface ColumnMapping { column: string; field: PatientField | "biomarker" | "ignore"; }
interface PatientIntakeResult {
  patients: Patient[];
  mapping: ColumnMapping[];        // per detected column: suggested target field
  stats: { rows: number; columnsMapped: number; columnsIgnored: number; cellsUnparsed: number };
  provenance: { adapter: string; extraction: "csv" | "xlsx"; trust: "high" | "medium" | "low"; note: string };
}
interface PatientSourceAdapter {
  id: string;
  detect(input): number;                 // 0..1
  extract(input, mappingOverride?): Promise<PatientIntakeResult>;
}
```

**Demo adapter: `csvAdapter`** handles both a pasted CSV string and an uploaded `.csv`/`.xlsx`:
- `.xlsx` → rows via the existing `xlsxRows()` (zero-dep, reused). `.csv`/text → a small
  dependency-free RFC-4180-ish CSV parser (quotes, embedded commas/newlines).
- First row = headers. For each header, `headerMap` suggests a target field; each cell is run through
  the field's normalizer; the assembled row becomes a `Patient` (with a generated stable `id` when
  the CSV has none, and `siteId` set by the caller).
- `mappingOverride` lets the verify UI re-structure after Camila corrects a column → field choice.

### Modules (small, single-purpose, unit-testable — following `site/new/parse.ts`'s pattern)

- `patient-intake/types.ts` — the interfaces above + `PatientField` union.
- `patient-intake/csv.ts` — `parseCsv(text): string[][]` (dependency-free).
- `patient-intake/headerMap.ts` — `suggestField(header): PatientField | "biomarker" | "ignore"` via
  synonym/regex table across the full `Patient` schema.
- `patient-intake/normalize.ts` — per-field value normalizers:
  - `sex`: `m/f/male/female/masculino/feminino` → `"male"|"female"`; else null.
  - `her2_status`/`er_status`/`pr_status`: `3+`/`pos`/`positive`/`+`→`"positive"`, `neg`/`0`/`1+`→`"negative"`; else null.
  - `stage`: roman/int `I–IV`; `ecog`,`age`,`prior_lines`: parsed ints (bounded); else null.
  - `diagnosis`: passthrough string.
  - labs (`creatinine`,`hemoglobin`,`platelets`,`bilirubin`,`ejection_fraction`): parse `"0.9 mg/dL"`
    **or** value + unit-from-header (e.g. `"Creatinine (mg/dL)"`), then **canonicalize via
    `units.ts`**; unreconcilable/blank → null.
  - unmapped-but-kept columns → `biomarkers[slug(header)]`.
  - **Every failure → null → `unknown`** (never a fabricated value).
- `patient-intake/csvAdapter.ts` — orchestrates parse → map → normalize → `Patient[]` + `stats`.
- `patient-intake/registry.ts` + `index.ts` (`defaultRegistry`) — future FHIR/OMOP/NLP adapters slot in.

### Trust tier

Deterministic CSV/XLSX structuring where every column mapped cleanly → **high**; some columns
guessed or values coerced → **medium**; many unparsed cells / unmapped columns → **low**. Drives the
verify UI's emphasis (mirror of the sponsor trust chip).

## UI flow — `/site/new` rewritten (upload → map → verify → list)

`/site/new` becomes a client component:
1. **Site fields** (name/city/region/monthlyIncidence) — unchanged.
2. **Upload / paste EHR data** — drag-drop `.csv`/`.xlsx` or paste CSV. On submit → `POST
   /api/patient-intake` (multipart or JSON) → `PatientIntakeResult`.
3. **Mapping table** — one row per detected column: `header → [target-field dropdown, heuristic
   pre-filled] → sample values`. Camila corrects any mapping; changing it re-POSTs with
   `mappingOverride` to re-structure (deterministic, fast).
4. **Preview + summary** — first N structured `Patient` rows + `stats` line ("220 rows · 8 columns
   mapped · 2 ignored · 14 cells unparsed → left unknown") + provenance/trust chip.
5. **List site →** — the server action writes the confirmed `Patient[]` via `upsertSite` +
   `replacePatients` (downstream unchanged), redirects to `/site`.

`src/app/api/patient-intake/route.ts` mirrors `/api/intake`: same 25 MB upload cap, clean 4xx on bad
input, runs `defaultRegistry().extract(input, mappingOverride)`.

## Privacy

Structuring runs **server-side on the site's own server** (same trust boundary as today's paste-JSON
→ `listSite` → site DB): patient rows never go to the sponsor and never leave that server. The
deterministic CSV path involves **no LLM**. An LLM column/value mapper would send patient data to a
cloud model — conflicting with the "rows stay local" thesis — so the production NLP answer is
**on-prem** (DoctorAssistant NLP→OMOP, PRD v4). For the demo (synthetic data) an LLM upgrade, if
added, is clearly labeled; it is not on the default path. This makes heuristic-first a *principled*
choice, not merely the easy one.

## Error handling

- Not CSV/XLSX, empty file, zero data rows, no mappable columns → clean error in the UI (no crash),
  reusing the sponsor route's 4xx discipline + the zip reader's malformed-input guards.
- Duplicate/blank `id` → generate a stable synthetic id (`row-<n>`); never drop a row silently.
- Unparseable cell / unmapped column → `null`/ignored, **counted in `stats`** and surfaced — never
  hidden. (Silent truncation is the one thing we don't do.)

## The messy sample CSV

`scripts/generate-messy-csv.ts`: from the existing synthetic panel (`generatePanel()`), emit a
realistic-but-messy CSV with odd headers (`Dx`, `HER-2 Status`, `Creatinine (mg/dL)`, `Perf Status`),
**mixed lab units** (some `g/dL` vs `g/L`), a free-text-ish diagnosis column, and scattered blanks —
so the mapping/verify step has something real to chew on. Written to `data/sample-ehr.csv`
(git-committed; it's synthetic).

## Testing

Pure functions get unit tests (as `site/new/parse.ts` does today), no DB needed:
- `parseCsv` — quotes, embedded commas/newlines, ragged rows.
- `headerMap` — synonym coverage + "ignore"/"biomarker" fallbacks.
- `normalize` — each field's value coercions incl. lab unit canonicalization and the null-on-failure
  guarantee.
- `csvAdapter` — the committed `data/sample-ehr.csv` → expected `Patient[]` (golden), and `stats`
  correctness (mapped/ignored/unparsed counts).
- An end-to-end test: sample CSV → `Patient[]` → `evaluateDataset` against the hero criteria yields a
  sane tri-state split (proves imperfect structuring lands in "possible", not wrong "excluded").

## Scope

- **Now (demo):** CSV/XLSX `csvAdapter` + heuristic mapping + verify UI + messy sample + tests.
  `/site/new` upload flow fully replaces paste-JSON.
- **Roadmap (same registry):** FHIR Bundle → `Patient[]`; OMOP CDM rows; on-prem NLP clinical notes.
