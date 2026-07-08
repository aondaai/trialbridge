# TrialBridge — Product Spec (v4)

**Built with Claude: Life Sciences Hackathon (Build Track) — July 7–13, 2026**

Working title. Portuguese-market alt name to consider: "Elegível" (Portuguese for "eligible").

> **Version history**
> - **v2:** Added the **Protocol Design Studio** (design/optimize a protocol against live capacity before it's locked) and the **Standing Capacity Registry**.
> - **v3:** Introduced **real, population-scale data** — DataSUS OMOP (60M+ patients) as the national aggregate layer powering geography, design-studio population signal, feasibility/fill-speed, and an OMOP-native matching engine.
> - **v4 (this doc):** Resolved the row-level depth question. The **DoctorAssistant NLP→OMOP pipeline** — clinical events extracted from free-text Portuguese notes and standardized to OMOP with SNOMED / RxNorm / LOINC codes **plus a clinical `assertion` on every event** — becomes the real row-level tier. This carries the oncology detail eligibility turns on (biomarkers, labs, drugs/prior lines, findings) that DataSUS lacks, and unlocks a capability incumbents structurally cannot match: **evaluating negative and historical criteria** (exclusion criteria, negation, family history). Synthetic data drops from a required tier to an optional gap-filler. Engine, governance, timeline, and pitch updated. New/changed items flagged `[v2]`/`[v3]`/`[v4]`.

---

## Problem Statement

Clinical trial recruitment is the industry's single biggest bottleneck: 86% of international trials fail to hit their patient recruitment target within the planned timeframe, and the median number of eligibility criteria per protocol has grown 58% in the last two decades, making manual chart-matching increasingly unworkable. AI-driven drug discovery is accelerating the number of trials competing for an already-scarce US/EU patient pool — 173 AI-originated drug programs are now in clinical development, up from 3 in 2016.

This is pushing sponsors toward emerging markets: Brazil grew from 25 registered clinical studies in 2000 to 403 in 2024, and oncology trial costs there run ~65% lower than in the US. But two things are broken: (1) hospitals and site networks in these markets can't prove their patient capacity fast enough to win incoming trial volume, and (2) sponsors have no fast, structured way to discover which sites/CROs globally can actually deliver against a given protocol — today it's manual RFIs, cold outreach, and weeks of waiting, in both directions.

**`[v2]` The upstream problem.** The most expensive recruitment mistakes are made *before* a protocol is locked. 76% of sponsors report criteria-related discrepancies that led to failed trials. Once a protocol is finalized and sites are engaged, loosening a criterion means a costly amendment. TrialBridge moves that visibility to design time.

**`[v3]/[v4]` The evidence gap incumbents can't close.** Emerging markets are "invisible" not because patients aren't there, but because no one has surfaced them in structured, queryable form. TrialBridge runs on **real Brazilian data**: national breadth from **DataSUS (60M+ patients, OMOP)** and clinical depth from the **DoctorAssistant NLP→OMOP** clinical-note pipeline. Where incumbents show historical trial performance, TrialBridge shows the *actual patients* — how many, where, and — crucially — with enough clinical detail to evaluate the real inclusion **and exclusion** criteria.

**Primary named user:** Dra. Camila Rocha, Clinical Research Coordinator at a large academic hospital network in São Paulo.

**Secondary named user:** Marcus, VP of Clinical Operations at a mid-size biotech, planning a Phase II oncology trial and still shaping its eligibility criteria.

*(Both are composite personas.)*

---

## Prior Art & Competitive Landscape

**Manual process (default):** candidate site list from past collaborations + KOL referrals, then feasibility questionnaires and prestudy visits. Only ~65% of questionnaires are returned; 76% of sponsors report criteria discrepancies that led to failed trials; 80% of sites say the questions are generic, not trial-tailored.

**TriNetX / IQVIA:** federated RWD platforms letting sponsors query aggregate EHR counts and see per-criterion cohort impact — functionally similar to our softening/design-studio features, but consultant-mediated, and `[v3]` weighted to US/EU coverage where emerging-market populations are thin.

**Citeline / DrugDev / GlobalData:** historical trial-performance databases — who ran trials well before, not where eligible patients currently are.

**The structural gap:** identification is driven by past performance, not by where suitable patients are; low-trial-history / low-EHR-coverage markets are invisible even when patients exist. Same disadvantage faces Brazil.

**Differentiation:** self-serve, not consultant-mediated; bidirectional (sites declare capacity); `[v2]` design-time, not only feasibility-time; `[v3]` grounded in real emerging-market population data incumbents lack; `[v4]` **able to evaluate exclusion / negation / history criteria** because the underlying data preserves a clinical assertion per event — most claims-derived RWD platforms can only reliably confirm presence, not absence.

---

## Goals

1. Cut site-side feasibility answer time from days to minutes.
2. Cut sponsor-side global site discovery/assessment from weeks to a single session.
3. Make every patient-match transparent and auditable — no black box.
4. Interactive protocol softening — see how loosening a criterion changes the pool.
5. **`[v2]`** Let sponsors design/optimize a protocol from scratch against live capacity before locking.
6. **`[v3]`** Ground the experience in real population-scale evidence (DataSUS) at national + regional resolution.
7. **`[v4]`** Evaluate full eligibility logic — inclusion *and* exclusion, including negated and historical conditions — against real clinical depth, with every match traceable to its source.
8. Demonstrate a working two-sided loop.
9. Ship something that still runs and is useful the week after the hackathon.

---

## Non-Goals (v1 / hackathon week)

- **`[v4]` No identifiable patient data.** Row-level data comes from **de-identified** sources: DataSUS (public de-identified administrative microdata) and the DoctorAssistant NLP→OMOP dataset (used under its existing de-identification and data-governance terms — confirm per open question). National-scale exposure is **aggregate counts only**, never rows.
- **No live/operational EHR integration.** Data is loaded from prepared OMOP datasets, not real-time hospital feeds.
- **No general-purpose marketplace infrastructure.** No open sign-up, auth, or payments. One seeded consultation, 2–3 seeded sites — mechanic real, participant scale simulated.
- **No true federated/secure-enclave infra yet.** All datasets in one analytical environment (DuckDB over OMOP in GCS); the aggregate-only boundary is enforced in query logic. Production federation is the v2 direction.
- **No regulatory/consent workflow.**
- **No non-oncology therapeutic areas in v1.**
- **No negotiation/contracting features.**
- **`[v4]` Synthetic data is no longer a core tier** — retained only as an optional gap-filler for fields the real datasets don't cover (e.g., sparse staging) or to guarantee clean partial-match demo cases.

---

## Data Architecture `[v4]`

Three real sources, one OMOP CDM, one matching engine. Each source plays to its strength.

**Tier 1 — National population breadth (aggregate-only): DataSUS OMOP.**
- 60M+ patients. Strong on diagnosis + geography; weak on trial-critical clinical detail.
- Query path: aggregate mode only — cohort counts/distributions by region/state, never rows.
- Powers: geographic "where are the patients," design-studio national population signal, feasibility/fill-speed.

**Tier 2 — Clinical depth, row-level: DoctorAssistant NLP→OMOP.**
- Clinical events extracted from free-text Portuguese notes via NER, standardized to OMOP:
  - **Diseases / lesions / clinical findings → SNOMED CT →** `condition_occurrence` / `observation`
  - **Procedures → SNOMED CT →** `procedure_occurrence` / `measurement`
  - **Devices → SNOMED CT →** `device_exposure`
  - **Drugs → RxNorm →** `drug_exposure` *(prior treatment lines)*
  - **Biomarkers → LOINC (+ manual map) →** `measurement`
  - **Lab exams → LOINC (+ manual map) →** `measurement`
- **Every clinical event carries an `assertion`:** `PRESENT`, `HISTORY`, `INVESTIGATION`, `ABSENT`, `FAMILY_HISTORY`, `OTHER`. This is the eligibility unlock — inclusion criteria key off `PRESENT`; exclusion criteria key off `ABSENT`/`HISTORY`; family-history criteria key off `FAMILY_HISTORY`.
- **Dual queryability by design:** each record stores both a standardized `*_concept_id` and the original `*_source_value` + `assertion` (+ `entity_search`), with a raw NER trail in `note_nlp`. So a criterion can be evaluated by OMOP concept hierarchy *or* by original-text + assertion — and **every match traces back to the exact phrase in the source note.**
- `person`, `visit_occurrence`, `note`, `death` are populated by separate ingestion flows, so demographics (age/sex) and encounter context are available for eligibility.
- Powers: row-level per-criterion pass/fail transparency for the seeded sites; Camila's private matching; proof-of-capacity.

**Tier 3 — Synthetic (optional gap-filler).**
- Only where Tier 2 is thin (e.g., structured staging) or to guarantee clean demo partial-matches. Same OMOP shape so the engine is indifferent to source.

**Why this is the winning configuration:** DataSUS proves the market exists at national scale (breadth); DoctorAssistant proves each individual match is real and auditable down to the source phrase (depth + provenance); the assertion layer proves TrialBridge can handle the half of every protocol — exclusion criteria — that claims-only platforms fumble. Incumbents have none of the three for Brazil.

**Honest limits, shown not hidden:**
- OMOP has limited standard vocabulary for `FAMILY_HISTORY`, `ABSENT`, `INVESTIGATION`, `OTHER`; those events may carry `concept_id = 0` with `source_value` + `assertion` populated. The matcher must therefore use the **text + assertion path** for negative/family/investigational criteria, not concept hierarchy alone.
- **Cancer staging (TNM)** is the one field not confirmed as consistently structured — it may live in free text / findings. Flagged as an open question; synthetic Tier 3 or a staging-parse pass covers the gap if needed.

---

## User Stories

**Site side (Camila):**
- Paste/upload eligibility criteria without re-keying.
- See ranked candidates with per-criterion meet/fail breakdown — **`[v4]`** each pass/fail traceable to the source note phrase and its assertion.
- Browse open sponsor consultations relevant to her population.
- Submit de-identified proof-of-capacity in one click.
- **`[v2]`** Publish a de-identified aggregate capacity profile once, to be discoverable by sponsors still designing.

**Sponsor side (Marcus):**
- Post a protocol's criteria as an open consultation.
- See aggregated per-site candidate counts, no row-level data.
- See which criteria shrink the pool most; simulate loosening them.
- **`[v2]`** Build a protocol from scratch in a design studio; watch the projected pool respond to each criterion.
- **`[v3]`** See the national eligible-pool estimate (DataSUS) and its regional distribution while designing.
- **`[v4]`** Trust that exclusion criteria ("no prior anti-PD-1," "no active autoimmune disease," "no family history of X") are actually evaluated, not silently skipped.
- **`[v3]`** See a feasibility/fill-speed estimate grounded in real prevalence.
- **`[v2]`** Promote a finished draft into a consultation in one click.

**Cross-cutting:**
- The aggregate-only privacy boundary is visually obvious, not just asserted.

---

## Requirements

### P0 — Must-Have

- **Criteria ingestion:** paste trial text (or fetch by ClinicalTrials.gov ID) → structured inclusion/exclusion rules, shown back for verification. **`[v4]`** each parsed rule tagged with the assertion it implies (e.g., exclusion → `ABSENT`/`HISTORY`).
- **`[v3]/[v4]` OMOP-native matching engine, dual-path:** deterministic rule evaluation against OMOP CDM tables, resolving each criterion via **(a) `*_concept_id` + SNOMED/RxNorm/LOINC hierarchies** and **(b) `*_source_value` + `assertion`** where concepts are absent/negative. Two execution modes on the same rules: **aggregate** (Tier 1) and **row-level with per-criterion pass/fail + source-phrase provenance** (Tier 2).
- **`[v3]` DataSUS OMOP national layer (live):** aggregate cohort counts by region return live (with cached-snapshot fallback for demo reliability).
- **`[v4]` DoctorAssistant row-level layer:** seeded sites backed by real NLP→OMOP records; per-criterion transparency uses concept + assertion + `note_nlp` trail.
- **`[v3]` Feasibility / fill-speed estimate** from real prevalence + volume (was P1, now P0).
- **`[v2]` Standing Capacity Registry:** each seeded site publishes a de-identified aggregate profile; registry answers criteria with counts/distributions only.
- **`[v2]` Protocol Design Studio:** each criterion edit re-queries DataSUS (national) + registry (sites) deterministically; live total/per-region/per-site pool; inline softening; "promote to consultation."
- **`[v3]` Geographic capacity view:** regional/state counts (DataSUS) + seeded-site markers, map/bar.
- **Sponsor consultation flow / site discovery + response flow / sponsor aggregated view / protocol softening tool** — as specified, all on the one engine.

### P1 — Nice-to-Have
- **`[v2]`** Criterion-suggestion prompts in the studio (flag dominant bottleneck).
- **`[v4]`** "Explain this match" popover showing the source note phrase + assertion behind each pass/fail.
- Feasibility scorecard export (PDF).
- Bilingual UI (PT/EN).

### P2 — Future (architecture should not preclude)
- Real-time EHR/FHIR connectors feeding the OMOP layer.
- True federated / secure-enclave matching across DataSUS + hospital nodes.
- Open many-sponsor/many-site marketplace with auth.
- Consent + outreach workflow post-match.
- Contracting/negotiation.
- Beyond oncology (mostly a criteria-parsing + vocabulary extension given OMOP + the NER pipeline).

---

## Governance & Privacy `[v3]/[v4]`

- **De-identification:** DataSUS microdata is public + de-identified. The DoctorAssistant NLP→OMOP dataset is used under its existing de-identification and data-use terms — **`[v4]` confirm** the de-id method and that trial-feasibility analytics is a permitted use before wiring row-level.
- **Aggregate-only national exposure** with a **minimum cell-size threshold** (suppress cohorts below N) to prevent small-cell re-identification.
- **Provenance without exposure:** the `note_nlp` / `source_value` trail powers auditability *inside* a site's private view; it never crosses the aggregate boundary to the sponsor.
- **LGPD alignment:** aggregate-only + de-identified keeps the build outside identifiable-data handling; production federation is the path to stronger guarantees.
- **Auditability as a safety property:** deterministic rule matching means every count and every match is explainable and reproducible — no model silently inferring sensitive attributes.

---

## Success Metrics (demo, not production)

**Demo-time:**
- Criteria paste → ranked matches: under 30 seconds.
- Viewer can explain why a patient did/didn't match, from the UI alone, within 10 seconds — **`[v4]`** including seeing the source phrase + assertion.
- Softening toggles update the count immediately.
- **`[v2]`** Design-studio criterion edit updates total + per-region counts within ~1–2 seconds.
- **`[v3]`** Live national DataSUS figure renders and drills to regional counts without reload.
- **`[v4]`** At least one **exclusion** criterion visibly filters candidates (proves negative-criterion capability).

**Pitch:**
- Thesis in under 60 seconds before software.
- Both sides of the loop shown in time.
- **`[v2]`** Marcus designs against live capacity before posting.
- **`[v3]`** Real 60M figure as credibility anchor.
- **`[v4]`** "It even handles exclusion criteria — because we know what the patient *doesn't* have, from the note" lands as the technical mic-drop.
- Privacy boundary visually self-evident.

---

## Risks & Mitigations

- **Live 60M-scale query in a demo.** → Precompute/cache the demo protocol's regional aggregates behind the live path.
- **`[v4]` Assertion/vocabulary coverage for negatives.** OMOP concept gaps for ABSENT/FAMILY_HISTORY. → Engine's text+assertion path is the mitigation; validate on the demo protocol's specific exclusion criteria early.
- **`[v4]` Staging (TNM) not consistently structured.** → Tier 3 synthetic or a targeted staging-parse pass; or choose a demo protocol whose staging criterion maps to available data.
- **Scope vs. 5 days.** → Build the engine once against OMOP; Tier 2 data already exists as a production pipeline output (major de-risk — it's not built from scratch this week); keep synthetic as the guaranteed-working fallback.
- **`[v4]` Governance sign-off on the DoctorAssistant dataset.** → Confirm de-id + permitted-use before row-level wiring; aggregate-only demo works even if row-level clearance lags.

---

## Open Questions

- `[Team]` Paste-in criteria vs. live ClinicalTrials.gov fetch for the one demo protocol?
- `[Team]` Oncology. **→ Confirmed.**
- `[Team]` Seeded sites. **→ Confirmed (3).**
- `[Design]` Portuguese-first or English-first UI for an international panel?
- `[Team]` Name incumbents (TriNetX/IQVIA/Citeline) directly, or stay implicit?
- **`[v2]`** Design Studio opens blank vs. CT.gov-template pre-loaded? *(Recommend: template-first for demo.)*
- **`[v2]/[v3]`** Geographic granularity. **→ Resolved:** DataSUS supports real region/state; sites shown as markers.
- **`[v4]` — NEEDS INPUT:** Is **cancer staging (TNM)** structured in the DoctorAssistant OMOP output, or free-text/findings only? Determines whether a staging inclusion criterion runs on real data or needs a parse pass / synthetic fill.
- **`[v4]` — NEEDS INPUT:** De-identification method + permitted-use status of the DoctorAssistant NLP→OMOP dataset for trial-feasibility analytics — clears row-level wiring.
- **`[v3]`** DataSUS OMOP vocabulary mapping completeness (ICD-10→SNOMED? ATC/RxNorm for drugs?) for the demo protocol's criteria.

---

## Timeline — Hackathon Week (July 7–13, 2026)

> **Calendar:** runs **Tue Jul 7 → Mon Jul 13**. Today (Wed Jul 8) is **Day 2**. Big de-risk in v4: the row-level Tier 2 data **already exists** as a DoctorAssistant pipeline output — the week is about *wiring and matching*, not generating clinical depth from scratch.

| Day | Date | Focus |
|---|---|---|
| Day 1 | Tue Jul 7 | OMOP schema + site/region tags; confirm Tier 2 dataset access; lock criteria-parsing prompt/schema (incl. assertion tagging) |
| Day 2 | Wed Jul 8 | **`[v3]/[v4]`** OMOP-native dual-path matching engine (concept_id + source_value/assertion; aggregate + row-level modes) + per-criterion transparency; stand up DataSUS in DuckDB/GCS; confirm aggregate counts return |
| Day 3 | Thu Jul 9 | **`[v3]`** Live DataSUS counts API (+ cached fallback); **`[v4]`** wire DoctorAssistant row-level tier for 3 seeded sites; **`[v2]`** capacity registry profiles; consultation + site discovery/response flows |
| Day 4 | Fri Jul 10 | **`[v2]`** Protocol Design Studio + "promote"; sponsor aggregated view + softening; validate exclusion-criteria path on the demo protocol |
| Day 5 | Sat Jul 11 | **`[v3]`** Geographic view + feasibility/fill-speed; **`[v4]`** "explain this match" provenance popover (P1); scorecard export (P1); polish |
| Day 6 | Sun Jul 12 | Bilingual pass if time; studio criterion-suggestions if time; write + rehearse demo |
| Day 7 | Mon Jul 13 | Dry-run, cut anything shaky, submit |

---

## Demo Script Outline (4.5–5 min)

1. **Thesis (30–45 sec):** AI accelerates discovery → more trials chasing a shrinking US/EU pool → emerging markets absorb the overflow, but neither side can prove fit fast enough.
2. **`[v3]` The real number (20 sec):** "Brazil's oncology population — 60 million patients, standardized to OMOP. Real, not projected." Show the national figure.
3. **`[v2]` Marcus designs, doesn't just post (45 sec):** Design Studio — add a criterion, national pool + regional map + seeded-site counts update live; one criterion crushes the pool; loosen the stage range, watch it recover.
4. **`[v4]` The exclusion moment (30 sec):** add an exclusion criterion ("no prior anti-PD-1 therapy"). Candidates drop — because we know what patients *don't* have, from their notes. *This is the capability incumbents can't demo on emerging-market data.*
5. **Promote to consultation (10 sec).**
6. **`[v4]` Camila (25 sec):** runs it privately against her hospital's real NLP→OMOP patients; opens one candidate's per-criterion breakdown — each pass/fail links to the exact note phrase + assertion. Submits proof of capacity in one click.
7. **Aggregated view (30 sec):** Marcus sees per-site counts + bottleneck criterion + geographic split — no row-level data crosses the boundary.
8. **`[v3]` Feasibility (20 sec):** realistic fill-speed from real prevalence.
9. **Close (15 sec):** *design your protocol against where the patients actually are — proven on 60 million real records, down to the exact phrase in the chart.* The two-sided discovery layer the market says is missing — built in a week, still running today.

---

*Next steps: answer the two `[v4]` data open questions (staging structure; de-id/permitted-use of the DoctorAssistant dataset), confirm DataSUS vocabulary completeness, then continue in Claude Code.*
