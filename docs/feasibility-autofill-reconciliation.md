# Reconciliation — Feasibility Autofill spec ⟶ existing TypeScript app

**Context.** A build-ready engineering spec was handed in (`feasibility-autofill-spec.md`, from the
prior analysis session) describing a **greenfield Next.js + FastAPI + Postgres + pgvector** module
that turns a sponsor's feasibility questionnaire into a review-and-approve task via four answer
archetypes (A/B/C/D). It ships with a seed workbook, `DoctorAssistant_Feasibility_QuestionBank.xlsx`
(canonical form model + a pre-labelled question bank + the capability-catalog template).

But `trialbridge/` is already a **mature Next.js 15 / TypeScript app on SQLite** with a Python FastAPI
*estimator* sidecar, and it already made a documented decision (`docs/reconciliation-plan.md`,
user 2026-07-10) to build feasibility features **onto the TS app**, treating the Python/Postgres eng
spec as a *target, not a rebuild*. The autofill spec's E0 (Postgres migrations + pgvector) reintroduces
the direction that plan deferred.

**Decision (user, 2026-07-11):** *Reconcile onto the existing TypeScript / SQLite codebase.* Reuse the
intake, matcher, concept-map, and parse machinery that already exists; add only what is genuinely new
(the request/inbox/autofill flow, the institution profile + capability catalog, the prior-answer RAG
memory). No Postgres, no pgvector service — embeddings, if needed for D, go into the existing Python
estimator sidecar or a plain in-repo index. Nothing is thrown away.

---

## Gap analysis — spec component → existing TS

| Autofill spec component | Existing TS/Python equivalent | Status |
|---|---|---|
| Ingestion: `.docx`/tables → fields (§6 #1, `python-docx`) | `src/lib/intake/` — DOCX/PDF/XLSX/eCTD/FHIR/CT.gov, dependency-free; `/api/intake`; `intake/locateEligibility.ts` | **REUSE** — extend registry, don't rebuild |
| Cohort engine C + protocol softening (§6.3) | `src/lib/matcher/{engine,soften,aggregate}.ts` — tri-state, unit-canon, `<5` suppression, `rankBottlenecks`; Python DataSUS estimator for national N | **DONE / STRONG** — the largest overlap |
| Concept ontology + classification (§5, §6.2) | `concept-map.json` (frozen, shared TS↔Python) + `src/lib/omop/conceptResolver.ts`, `conceptMap.ts` | **PARTIAL** — no PT-BR synonyms, no embedding tier yet |
| Narrative resolver D — LLM draft + citations (§6.4) | `src/lib/parse.ts` (Claude `opus-4-8`, structured, human-verify gate); `locateEligibility` LLM assist | **PARTIAL** — no prose generator; reuse the LLM-containment pattern |
| Docx render-back (§6 #6) | *none* — intake reads DOCX, nothing writes it | **MISSING** (new) |
| `institution_profile` + team (archetype A) | *none* — `Site` has name/country/region only | **MISSING** (new) |
| `capability_catalog` (archetype B repository) | *none* — capability is implicit in `Patient.data` + concept-map | **MISSING** (new) — seed from QuestionBank |
| `feasibility_request` / `form_field` / `field_answer` | *none* — `Consultation`/`Response` is protocol-post + capacity-response, not questionnaire autofill | **MISSING** (new) — the core of this module |
| `prior_form_answer` RAG memory (archetype D) | *none* | **MISSING** (new) |
| Provenance + confidence + DQ on every answer (§9) | `Metric` value object + 5 provenance seals (`src/lib/metric.ts`); `parse` confidence; intake `trust` | **REUSE** — answers carry `Metric`, not a bespoke provenance blob |
| Feasibility scorecard tie-in (§1, E6) | Scorecard reconciliation in flight (`Metric`, seals; R0–R9 in `reconciliation-plan.md`) | **COORDINATE** — feed it, don't fork |
| Postgres + pgvector (§4, §5) | SQLite (4 models); Postgres = ADR future-swap + throwing stub | **REJECTED for now** — stay on SQLite/Prisma |

---

## Archetype routing → concrete modules (the spec's central design, mapped)

The A/B/C/D split is sound and survives reconciliation. Where each resolver lands in *this* repo:

- **A — static institutional fact** → new Prisma `InstitutionProfile` + `InstitutionTeam`, deterministic
  lookup. Seed from QuestionBank §Perfil da Instituição fields (G-03, I-01, R-01, D-01, EQ-01, CP-01/02,
  CT-01, MAT-01). Answer wraps a `Metric` with seal `SITE_DECLARED`.
- **B — database capability / metadata** → new Prisma `CapabilityCatalog` (one row per data-source ×
  concept), lookup keyed by canonical concept via `conceptResolver`. Seed from QuestionBank
  **Catálogo de Capacidade** template (V-01…V-13). Seal `SITE_DECLARED`, with `completeness` → DQ.
- **C — patient count / population** → **reuse `matcher/engine` + `aggregate` (per-site) and the Python
  estimator (national/DataSUS-standardized)**. Protocol softening = existing `soften.ts`. Counts carry
  the estimator's `observed→registry_gov/site_declared` / `imputed→modeled` mapping already defined in
  `reconciliation-plan.md`. Small-cell suppression already enforced (`<5`; spec says k=11 — pick one, see
  Open items).
- **D — narrative / judgment** → new `narrative` resolver reusing the `parse.ts` LLM-containment pattern
  (Claude, structured, **always `status=proposed`, human-approve gate**). RAG over a new `PriorFormAnswer`
  store. Seal `MODELED`, low confidence, never auto-approved.

**Invariants preserved (match spec §13 + repo purity rule):** A/B/C deterministic and provenanced; D
always human-gated; no answer reaches `approved` without a `Metric`; LLM confined to one auditable step;
pure layers (`matcher/**`, `scoring/**`, any new `resolvers/pure/**`) stay free of `fetch`/Prisma/`Date.now()`.

---

## QuestionBank seed inventory (E0 input — ready to use)

The workbook is directly usable; it is the concrete value delivered with the spec.

- **Modelo Canônico** (16 rows) — the canonical section list, each tagged dominant archetype + "varies per
  study?". → ground-truth `form_template` structure.
- **Arquétipos** (A/B/C/D) — the routing table with the ~20/45/15/20% shares the design rests on.
- **Banco de Perguntas** (32 fields: G/I/R/D/P/X/TA/V/POP/CNT/EQ/CP/CT/LIM/MAT) — each pre-mapped to
  archetype + canonical concept + system source + answer strategy + auto-confidence. → a ready-made
  **classifier label set** for E1.
- **Catálogo de Capacidade** — the archetype-B repository template; one real example row (iHealth/DII,
  CID-10 K50/K51, NLP+assertion, "Alta"), remaining rows `[preencher]`. → `CapabilityCatalog` seed shape.

---

## Two real gaps the spec understates

1. **Therapeutic-area mismatch.** The QuestionBank concepts center on **ASCVD / IBD** (LDL/LOINC 13457-7,
   IAM/CID-10 I21, ATC drug classes, K50/K51). The repo's `concept-map.json` and estimator are currently
   **oncology-only** (breast/lung; C50, C33–C34). Seeding the catalog for both MSD TAs means *extending the
   ontology into cardiometabolic/immunology*, not porting existing entries. Scope this explicitly in E0.
2. **PT-BR synonyms are new.** The QuestionBank's *Sinônimos* column is PT-BR (DII, IBD, Crohn, retocolite;
   IAM, infarto), but `concept-map.json` today carries **English SNOMED/LOINC/RxNorm + CID-10 codes and no
   synonym lists**. The spec's synonym→code→embedding→fallback classifier (§6.2) needs a new PT-BR synonym
   layer. Start it from the QuestionBank column; grow it via the learning loop.

---

## Corrected build order (TS-first, additive; mirrors reconciliation-plan.md discipline)

Each step ends green (typecheck + `vitest run` + `next build`) before the next.

- **F0 — Data model + seeds (SQLite/Prisma).** Add models `InstitutionProfile`, `InstitutionTeam`,
  `DataSource`, `CapabilityCatalog`, `FeasibilityRequest`, `FormTemplate`, `FormField`, `FieldAnswer`,
  `CohortDefinition`, `PriorFormAnswer`, `AuditLog` — **all scoped by `siteId`**, JSON columns where the
  spec used jsonb. Import script: QuestionBank.xlsx → `FormTemplate` (Modelo Canônico) + `CapabilityCatalog`
  (Catálogo) + classifier label fixtures (Banco de Perguntas). *No Postgres, no pgvector.*
- **F1 — Ingestion & classify.** Extend `src/lib/intake/` to emit `FormField[]` + a template fingerprint
  (MSD recognition). Classifier: synonym → code → (embedding, deferred) → Claude-shortlist → unmapped;
  P/R test against the Banco de Perguntas label set.
- **F2 — Deterministic A/B + render-back.** `profileResolver` (A) + `capabilityResolver` (B), each returning
  a `Metric`. New DOCX **writer** (unzip → edit `document.xml` → rezip) — the one genuinely missing intake
  capability. `/diff` guard so nothing unapproved ships.
- **F3 — Cohort (C).** Wire the questionnaire's `criteria` to **existing** `matcher/engine` + `soften` +
  the Python estimator; expose per-criterion deltas. Reuse existing suppression (reconcile k=5 vs 11).
- **F4 — Narrative (D) + HITL.** `PriorFormAnswer` store + retrieval; `narrativeResolver` on the `parse.ts`
  pattern; review workspace (FieldCard / SourceChip / ConfidenceMeter / DQBadge) under
  `src/app/site/feasibility/`; PATCH approve/edit; D never auto-approves.
- **F5 — Governance & learning.** DQ flags off `CapabilityCatalog.completeness`; `AuditLog` versioning;
  edit → synonym write-back + RAG index (grows the PT-BR layer).
- **F6 — Marketplace tie-in.** Feed the in-flight scorecard `Metric`s from these structured answers; the
  inbox reuses the `Consultation`/`Response` primitives rather than a parallel sponsor-dispatch table.

---

## Open items to confirm before F0

- **Suppression threshold:** repo uses `<5`, spec says k=11. Pick one project-wide (recommend keeping repo's
  `<5` unless a sponsor contract requires 11).
- **Embedding tier for classify/RAG:** defer to F1/F4, and when needed put it in the **Python estimator**
  (already has the data plane) rather than adding pgvector. Confirm embedding model.
- **Scorecard integration branch:** the `Metric`/scoring/report engine spans branches (R0–R9). Confirm the
  integration target before F6 so the autofill answers feed it rather than fork it.
- **Route placement:** new UI under `src/app/site/feasibility/` (Camila track), consistent with existing
  `src/app/site/*`.

---

*Companion assets: `feasibility-autofill-spec.md` (the target design) and
`DoctorAssistant_Feasibility_QuestionBank.xlsx` (F0 seed). This doc is the reconciliation layer between
them and the actual repo.*
