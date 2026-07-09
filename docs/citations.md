# TrialBridge — pitch stat sourcing & hero-protocol verification

Adversarially fact-checked (each claim researched, then a second agent tried to
refute the sourcing). **Read this before the pitch.** Bottom line: the market
thesis is directionally sound, but several of the exact numbers in the spec are
weakly sourced or misattributed. Use the "Say this instead" line for each.

> Verdict key: **solid** (primary-sourced, safe) · **shaky** (real underlying
> effect, but the exact number drifts from the primary source) · **unverifiable**
> (no locatable primary source / documented misattribution — do not use as stated).

---

## The five macro stats

### 1. "86% of trials fail to hit recruitment target" — ❌ UNVERIFIABLE (drop it)
The most dangerous line in the deck. The "86%" traces only to an undated
CenterWatch trade attribution; the one blog carrying the spec's exact wording
footnotes **Carlisle et al. 2015 — whose actual figure is 19%, not 86%.** A judge
can expose the misattribution in one click. "International" is also invented.

- **Say this instead:** *"Roughly one in five trials (19%) terminate early for failed accrual or finish below 85% of target; and among trials that do enroll, most reach target only by nearly doubling the planned timeline."*
- **Cite:** Carlisle, Kimmelman, Ramsay & MacKinnon, "Unsuccessful Trial Accrual and Human Subjects Protections," *Clinical Trials* (SAGE) 12(1):77–83, 2015 — https://pmc.ncbi.nlm.nih.gov/articles/PMC4516407/ ; Tufts CSDD Impact Report, Jan 2013 — https://csdd.tufts.edu/publications/impact-reports

### 2. "Median eligibility criteria grew ~58% in two decades" — ⚠️ SHAKY
Real effect, wrong number and scope. The primary source (Garcia et al. 2017)
reports medians **16 → 27 = ~69%**, and it is **thoracic-oncology-specific**, not
"trial protocols" in general. The "58%" is arithmetic off a downstream misquote (17→27).

- **Say this instead:** *"In NCI/ECOG thoracic-oncology trials, median eligibility criteria per protocol rose from 16 (1986–1995) to 27 (2006–2016) — about 69% (Garcia et al., J Thorac Oncol 2017)."* For a broad claim: *"Tufts CSDD benchmarks show the typical Phase III protocol's eligibility criteria roughly doubled, ~31 (2002) → ~50 (2012)"* — and drop "median ~58%".
- **Cite:** Garcia S, et al., *J Thoracic Oncology* 2017;12(10):1489–1495, DOI 10.1016/j.jtho.2017.07.020 — https://pubmed.ncbi.nlm.nih.gov/28802905/

### 3. "173 AI-originated drug programs, up from 3 in 2016" — ⚠️ SHAKY
The **"3 in 2016" baseline is real and primary-sourced.** The **"173" is not** — it
appears only in 2026 aggregator blogs that cite each other (one self-contradicts:
title says 173, body says 200+, its own phase breakdown sums to 165). The primary
source's latest endpoint is **67 (2023)**.

- **Say this instead:** *"AI-discovered molecules entering clinical trials grew from just 3 in 2016 to 67 by 2023 — a >20× increase, and still expanding (Jayatunga et al., Drug Discovery Today, 2024)."* Only use "173/200+" if you first find a named 2025/26 tracker behind it.
- **Cite:** Jayatunga et al., "How successful are AI-discovered drugs in clinical trials?", *Drug Discovery Today* 2024;29(6):104009 — https://pubmed.ncbi.nlm.nih.gov/38692505/

### 4. "Brazil: 25 registered studies (2000) → 403 (2024)" — ⚠️ SHAKY (usable, attribute it)
Traces to WHO ICTRP data **via a market-research re-quote (Fortune Business
Insights)** — one secondary hop, and the exact integers couldn't be pulled from
WHO's non-exportable dashboard. Directionally solid (~16× growth). Note ClinicalTrials.gov
alone shows Brazil at 400–700/yr since ~2010, so "403" is WHO's narrower
recruiting-trials count — don't present it as total activity.

- **Say this instead:** *"Per WHO ICTRP data (via Fortune Business Insights), newly recruiting trials registered in Brazil grew roughly 16-fold — from about 25 in 2000 to around 403 in 2024."*
- **Cite:** WHO Global Observatory on Health R&D / ICTRP — https://www.who.int/observatories/global-observatory-on-health-research-and-development/monitoring/number-of-clinical-trials-by-year-country-who-region-and-income-group

### 5. "Oncology trial costs ~65% lower in Brazil vs US" — ⚠️ SHAKY (attribute it)
The "65%, oncology-specific" figure exists in **exactly one place: an unsourced
L.E.K. Consulting 2025 article** (no methodology). The best quasi-primary anchor
(A.T. Kearney) implies **~39% lower**, all-trials; a 2026 benchmark implies ~40–60%
region-wide. 65% sits at/above the high end.

- **Say this instead:** *"Industry analyses put oncology trials in Brazil at roughly 40–60% cheaper than the US per patient, with L.E.K. Consulting (2025) estimating ~65% for oncology specifically."* — always attribute the single number.
- **Cite:** L.E.K. Consulting, "Unlocking Brazil's Clinical Trial Opportunity," 2025 — https://www.lek.com/insights/life-sciences-pharma/unlocking-brazils-clinical-trial-opportunity-strategic-roadmap

---

## Hero protocol — NCT03529110 — ✅ VERIFIED, keep it
Confirmed as **DESTINY-Breast03**: *A Phase 3 … Study of DS-8201a (trastuzumab
deruxtecan) vs T-DM1 for HER2-Positive, Unresectable and/or Metastatic Breast
Cancer* (Daiichi Sankyo/AstraZeneca). **HER2-positive is a central, central-lab-confirmed
(ASCO-CAP) hard eligibility gate** — so it fully supports HER2-positivity as the
softenable "hero bottleneck." The **LVEF < 50% exclusion is also real.** No switch needed.

Our simplified criteria differ from the real protocol (all safe for a demo as long
as HER2-positive stays the highlighted gate):
- Real scope is "unresectable **or** metastatic"; our "stage IV" is narrower.
- Real HER2 requirement is central-lab ASCO-CAP confirmation on recent tissue.
- Real prior-therapy requirement is specifically **prior trastuzumab + a taxane**, not a generic ≥1-line count; **prior anti-HER2 ADC is an exclusion** we omit.
- The public record says "adequate renal/hepatic function" without publishing our exact lab cutoffs — treat our numbers as **illustrative**.
- Real exclusions also include **ILD/pneumonitis** (characteristic for this drug class) and a broader cardiac panel; we capture only LVEF.
- ECOG 0–1 is real but comes from the protocol, not the condensed CT.gov criteria field.

**If asked "are these the real criteria?"** — say: *"Modeled on DESTINY-Breast03 and simplified for the demo; HER2-positive, ECOG, LVEF and prior-therapy are all genuine gates. The exact organ-function cutoffs are illustrative."*

---

## Second protocol — NCT05920356 — ✅ VERIFIED, keep it

Confirmed as **CodeBreaK 202** (Amgen): Phase 3, RECRUITING — sotorasib +
platinum-doublet chemotherapy vs. pembrolizumab + platinum-doublet
chemotherapy, **first-line**, nonsquamous advanced/metastatic NSCLC,
**KRAS G12C-positive AND PD-L1-negative**. N=750, 383 sites, including 21 in
Brazil. Both molecular gates (KRAS G12C, PD-L1-negative) are real, central-lab-
confirmed eligibility criteria — so this fully supports the demo's honesty
point: two of the criteria that define the trial population sit on data a
claims-style source structurally can't observe.

Our simplified criteria differ from the real protocol (all safe for a demo as
long as the two molecular gates stay the highlighted "not evaluable" rows):
- Real scope is stage IV **or** unresectable/advanced IIIB–IIIC; our "stage
  IV only" is narrower.
- Real molecular requirements are central-lab NGS (KRAS) and IHC/TPS scoring
  (PD-L1); we don't sub-type further (e.g. PD-L1 TPS bands beyond negative/
  low/high).
- Real prior-therapy requirement is specific to the metastatic/non-curable
  setting; our synthetic data's "prior_lines" is a coarser proxy.
- Real exclusions also include a broader cardiac/organ panel; we capture
  brain metastases, recent MI, and prior KRAS G12C inhibitor only.

**If asked "are these the real criteria?"** — say: *"Modeled on CodeBreaK 202
and simplified for the demo; nonsquamous histology, stage IV, KRAS G12C,
PD-L1-negative, and no prior systemic therapy are all genuine gates. Exact
sub-typing (PD-L1 TPS bands, staging detail) is simplified."*

### Prevalence rates behind the modeled-eligible funnel

The `src/lib/modeledPrevalence.ts` module scales the matcher's OBSERVED
addressable pool into a `MODELED` biomarker-eligible estimate using two
cited rates:

- **KRAS G12C prevalence in NSCLC ≈ 13–15%** (poor-prognosis, smoker-enriched
  subgroup) — Gálffy et al., "Targeting KRAS Mutant Lung Cancer," *Pathology
  and Oncology Research* 2024;30:1611715, DOI
  [10.3389/pore.2024.1611715](https://doi.org/10.3389/pore.2024.1611715).
- **PD-L1-negative vs. negative-or-low (TPS 0–49%) — Beat 3's softening
  lever.** Remon et al., "KRAS G12C-mutant NSCLC: first-line treatment
  strategies," *Cancer Treatment Reviews* 2026, DOI
  [10.1016/j.ctrv.2026.103144](https://doi.org/10.1016/j.ctrv.2026.103144).
  Per this source, KRAS-inhibitor + immunotherapy combinations look most
  promising in **high PD-L1**, while chemo-immunotherapy regimens give more
  consistent benefit **irrespective of PD-L1** — CodeBreaK 202 deliberately
  restricts to PD-L1-negative (where IO monotherapy underperforms) as the
  cleanest population to isolate a KRAS-inhibitor effect from a
  pembrolizumab-chemo control. Widening to PD-L1 1–49% enlarges the
  addressable pool but muddies that rationale — the trade the demo narrates
  when Marcus clicks "widen."

**If asked "are these prevalence numbers real?"** — say: *"Yes — KRAS G12C
~13–15% of NSCLC and the PD-L1 negative-vs-negative-or-low split are both
PubMed-cited (Gálffy 2024, Remon 2026). The resulting patient COUNTS
(~1,900 addressable, ~75/yr modeled-eligible, illustrative against the
seeded synthetic panel) are demo-scale extrapolations, not observed data —
labeled MODELED throughout, same discipline as the funnel-discount numbers
above."*

---

*Generated from an adversarial research pass (11 agents, primary-source tracing +
refutation). Re-verify any figure you quote verbatim; sourcing drifts over time.*
