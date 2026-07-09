# TrialBridge Estimator — Roadmap

**Status:** living doc, updated 2026-07-09. Hackathon window: Jul 7–13, 2026 (Build Track). Today is Jul 9 — **4 days left, including the submit day.**

This tracks the DataSUS/OMOP + proprietary-enrichment direction (`outputs/trialbridge_estimator/`), kept deliberately separate from the Next.js "Elegível" app (`trialbridge/`) per the 2026-07-09 decision. Re-open that separation question below if priorities change.

---

## Where we are (verified today)

- **Method:** direct standardization — `estimated eligible = Σ_strata DataSUS_base[stratum] × depth_rate[stratum]` — not record linkage. See README §"Decided: standardization, not record linkage" for why (no shared patient ID exists between DataSUS and the proprietary base).
- **DataSUS base cohort:** real, national, from `gs://omop-sus/exports/ihealth_omop_sus` (63M person / 885M condition rows), mirrored locally at `data/omop_full` (25G), synced via `scripts/sync_datasus.sh`.
- **Proprietary depth rates:** real, NLP-extracted, breast cancer only (C50.x), 14 hospitals, 28,490 patients (2,355 complete-case HER2+ECOG). Heavily concentrated in one hospital (`ha`, 67%).
- **Estimator:** Wilson CIs, empirical-Bayes shrinkage for thin strata, bottleneck ranking, fill-speed. 5/5 unit tests pass.
- **API + UI:** FastAPI (`api.py`) + static UI (`ui/index.html`), verified against real data — `/health`, `/feasibility/estimate`, `/soften` all return live numbers, not mocks.
- **One protocol supported:** the hardcoded HER2+ metastatic breast cancer hero (`protocols.py`), 6 criteria (dx, sex, HER2, ECOG, metastatic, autoimmune-exclusion). No live Claude parsing wired into this path — PRD's "Criteria Parser" step isn't built here yet.
- **Geography:** state (UF) level only. Facility/CNES-level attribution is not built (needs a `visit_occurrence` → `care_site` join; that table is real but large — tens of GB, uneven part sizes).

---

## Decisions to make together

Each one has a real time cost against a 4-day budget — flagging trade-offs, not pre-deciding.

### 1. Protocol flexibility — **DECIDED 2026-07-09: build this next (top priority)**
- **A. Stay single-protocol** (current) — zero extra work, but the pitch can only ever show the one HER2+ mBC case.
- **B. Wire live Claude parsing** for the checkable/depth split (per the original architecture doc) — lets you paste any protocol; meaningful build (parser + verify UI + re-test the split logic), on top of everything else. **← chosen.**

### 2. Depth-criteria coverage (currently HER2, ECOG, metastatic, autoimmune only)
- **A. Stay as-is** — organ function, prior lines, brain mets, LVEF stay unextracted (hero protocol already documents this gap).
- **B. Extend the NLP extraction pass** over the raw ES dump for 1–2 more depth fields — real data work, not a quick toggle (re-running extraction across hospitals, re-fitting rates, re-validating thin strata).

### 3. Disease scope (currently breast cancer / C50 only)
- **A. Stay breast-cancer-only** — matches the verified hero protocol and existing pitch narrative.
- **B. Add a second cancer type** (e.g. lung, per the `TRUE_RATES` synthetic placeholder already in `data.py`) — needs a fresh extraction pass over the 904GB raw dump for a new ICD prefix; the biggest lift on this list.

### 4. Geographic granularity
- **A. Stay state-level (UF)** — real, exact, already works.
- **B. Push to CNES/facility-level** — the "site feasibility" story gets much stronger (real hospitals, not just states) but requires the `visit_occurrence`→`care_site` join `data.py` explicitly deferred as "out of today's transfer budget."

### 5. Frontend/demo polish
- **A. Current UI is enough** — functional, browser-verified, dark mode works.
- **B. Invest more** — choropleth accuracy (currently regions grouped into 5 macro-regions deliberately, not geographically precise), mobile layout, narrative/demo-script polish.

### 6. Integration with the Next.js "Elegível" app
- **Decided 2026-07-09: keep separate.** Re-open only if you want one unified pitch artifact instead of two.

### 7. Pitch deck Slide 6 (the "Rosetta Stone" diagram)
- **Decided 2026-07-09: defer to Sat/Sun polish pass**, bundled with #5. Still **must** happen before the final pitch — it currently describes record linkage, which the data can't support.
- **Reopened and re-closed same day (2026-07-09), now with a measurement, not just an argument.** Ran a spike (`scripts/spike_care_site_join.py`, isolated, not imported by production code) to test whether facility-level probabilistic linkage — DataSUS `condition_occurrence` → `person` → `visit_occurrence` → `care_site`, blocked on `(care_site_id, dx=breast_cancer, birth_year, sex)` — could plausibly work even without a shared patient ID. Used a random 3.6% sample of `visit_occurrence` (80/2201 parts, ~3GB; the full table is 89GB with no region/facility partitioning in the file layout, so a full sync was out of a 2-4h spike's budget) joined against the already-local `condition_occurrence`/`person` mirror and the full (small) `care_site` table.
  - Aggregated across **all** 25,072 facilities, blocking cells look small (median 2, 49% singleton) — but that's a Simpson's-paradox artifact of thousands of near-empty low-volume clinics/labs, not real discriminating power.
  - Restricted to the **5 highest-volume facilities in the sample** — the honest analog to where the real proprietary overlap concentrates (`'ha'` alone supplies 19,055 of 28,490 proprietary patients, i.e. a big hospital, not a one-off clinic) — median candidates per `(facility, birth_year, sex, breast_cancer)` cell is **14-44**, only **9-20% singleton**, max cell size **183-326**. `year_of_birth` (not full DOB) + sex + dx + facility does not disambiguate individuals at the volume real linkage would need — any 1:1 "match" would be arbitrary among a dozen-plus indistinguishable patients.
  - Separately confirmed: there's no crosswalk in this repo from the proprietary base's hospital codes (`ha`, `hac`, `hsl`, ...) to a DataSUS `care_site_id`/`care_site_name` either, so even Track B couldn't test the *actual* overlap hospital without building that mapping first.
  - **Re-confirmed decision: standardization, not record linkage.** The 2026-07-09 rejection in `README.md` ("no shared identifier exists") was correct and is now backed by a direct measurement, not just an argument from missing keys. No further time goes toward linkage — proceed with the Slide 6 rewrite as originally planned.
- **Drafted 2026-07-09:** `TrialBridge_pitch.md` doesn't actually exist as a file anywhere in this repo (only referenced by `README.md`) — the deck itself lives outside this project. Wrote the replacement content to `slide6_rewrite.md` (title, diagram, 30s narrative, the real verified example number, honest limits, and the mapping to what `/feasibility/estimate` already returns) so it's ready to paste in whenever the deck is available. Still needs: pasting into the real deck + a visual pass (this is text/ASCII, not a designed diagram).

### 8. Reproducibility / "still runs next week"
- **A. Leave as-is** — venv is set up (`~/.venvs/trialbridge_estimator`), works today.
- **B. Add `requirements.txt` + a bootstrap script** (and maybe a Dockerfile) so a fresh machine can stand this up without me re-deriving the dependency list.

### 9. Data freshness
- One-time sync is done. Decide whether to re-run `scripts/sync_datasus.sh` right before the demo (in case the upstream export changes) or leave it pinned.

### 10. Test coverage
- Current tests cover the estimator's math (5 tests). No tests hit `api.py`'s HTTP layer or edge cases (e.g. a region with zero proprietary coverage). Worth adding if this becomes the primary demo artifact.

---

## Sequencing — locked 2026-07-09

- **Thu (today):** build #1 — Claude criteria parser (checkable/depth split), wired into the estimator + API.
- **Fri:** finish/harden #1; start on #2/#3/#4 only if #1 lands early (not committed yet).
- **Sat:** polish pass — Slide 6 rewrite (#7), UI polish (#5).
- **Sun:** reproducibility (#8), test coverage (#10), rehearsal.
- **Mon:** dry-run, cut, submit.

#2 (more depth criteria), #3 (second cancer type), #4 (CNES granularity), #9 (re-sync) remain open — revisit if time allows after #1.
