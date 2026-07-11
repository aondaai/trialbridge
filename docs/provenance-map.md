# Report / scorecard provenance map

Every number surfaced to a sponsor on `/scorecard?view=engine` carries a **provenance
seal** and a **confidence** dot. This doc maps each figure to its seal and to the
backend source that produces it — and records the honesty audit (does each seal match
the real source?).

## The structural guarantee

`src/lib/metric.ts` defines a `Metric` value object: `{ value, provenance, confidence,
ci, asOf, sourceRefs, note }`. The assembler runs `assertProvenanced(report)` (spec §8
gate) over the whole report tree — **any bare number in a metric slot throws**. So it is
not possible to surface a number without a seal; the discipline is enforced at build
time, not by convention.

## The five seals (`Provenance`)

| Seal | Meaning | Default conf. | Design colour |
|---|---|---|---|
| `peer_reviewed` | Peer-reviewed literature / benchmark | HIGH | sage |
| `registry_gov` | Official registry or government data | HIGH | steel blue |
| `site_declared` | Declared by the site (marketplace-unique) | MEDIUM | plum |
| `modeled` | Computed by TrialBridge (funnel, score, transported estimate) | MEDIUM | ochre |
| `vendor_benchmark` | Vendor / CRO figure — directional | LOW | slate |

Confidence (● firm · ◐ directional · ○ soft) is separate from the seal — a `registry`
fact can still be LOW confidence, and vice-versa.

## Backend sources (where the numbers come from)

| # | Source | Module | Feeds | Seal(s) it produces |
|---|---|---|---|---|
| 1 | **DataSUS / OMOP estimator** (Render service `trialbridge-estimator.onrender.com`, bearer-gated) | `src/lib/estimator/{client,pools}.ts` | national pool, eligibility funnel, per-UF supply pools, softening levers, per-site pool allocation | base cohort = `registry_gov`; every estimate over it = `modeled` (+CI, +DataSUS citation) |
| 2 | **ClinicalTrials.gov** | `src/lib/ctgov/*` | competing-trial counts per region, investigators (PI/chair) | `registry_gov` when live; `modeled` LOW placeholder when not |
| 3 | **ABRACRO / ACESSE site directory** (imported from the two xlsx) | `src/lib/sites/directory.ts` + `scripts/import-sites.ts` | 397 real sites — CNES, inspection history, PI counts, ethics committee | real inputs → `modeled` component scores; confidence rolls up on real signals |
| 4 | **Cited constants** | `src/lib/constants.ts` (backed by `docs/citations.md`) | country-dimension anchors (reg. days, cost %, trials/million, GCP OAI, benchmarks) | `peer_reviewed` / `registry_gov` / `vendor_benchmark` per source credibility |
| 5 | **Parallel deep-web research** | `src/lib/parallel/*`, `src/lib/kol/enrich.ts` | KOL publications, society roles, guideline authorship (with citation URLs) | `modeled`, carrying `sourceRefs` from the researched basis |
| 6 | **Funnel / scoring model** | `src/lib/feasibility.ts`, `src/lib/scoring/*` | screen-to-enrol discount, 7-dim country + 9-comp site composites | `modeled` |

The web app reaches source 1 server-side via `fetchNationalEstimate()` (sends
`Authorization: Bearer $TB_ESTIMATOR_TOKEN`); if the estimator is unreachable or 401s,
the report **degrades to synthetic-cohort pools, labelled as such** — never fabricated.

## Section-by-section provenance

### §1 Decision snapshot
| Figure | Seal | Backend |
|---|---|---|
| Country score (composite) | `modeled` | weighted 7-dim roll-up |
| Projected enrollment /mo | `modeled` | DataSUS incidence × screen-to-enrol |
| Time to first patient | `modeled` | Lei 14.874 parallel-review target |
| Cost / patient | `modeled` (LOW, often —) | not declared for public sites |
| Risk index | `modeled` | guardrail composite |
| Top-site scores | `modeled` | site composite (see §5) |

### §2 Eligibility funnel — **the DataSUS spine**
| Figure | Seal | Backend |
|---|---|---|
| Base cohort | **`registry_gov`** (HIGH) | real row-level DataSUS/OMOP count |
| Survival % | `modeled` | base → eligible ratio |
| Estimated eligible (+CI) | `modeled` (MEDIUM) | **transported estimate** over the real base — `imputed → modeled` |
| Projected /mo | `modeled` | DataSUS fill-speed × screen-to-enrol |

The base is the **only** DataSUS figure sealed `registry` — because it is a real count.
The eligible estimate is `modeled` even though its base is real: it is a model transport,
so it is sealed honestly and carries its 95% CI + the DataSUS source label.

### §3 Country case (7 dimensions)
| Dimension | Contributing metric | Seal |
|---|---|---|
| Regulatory speed | ANVISA days, CEP ethics days | `registry_gov` |
| Patient supply | national eligible pool | `modeled` (DataSUS) |
| Competitive saturation | trials/million BR vs US | `registry_gov` |
| Cost | LatAm cost % of US/EU | `peer_reviewed` |
| Infrastructure | research-ready site count | `modeled` — *demo estimate (70); CNES/RNPC connector pending* |
| Data quality | FDA GCP OAI rate | `peer_reviewed` |
| Logistics | IMP import lead time | `modeled` (IMP import also has a `vendor_benchmark` variant) |

### §4 Supply vs demand (Brazil tile-map)
| Figure | Seal | Backend |
|---|---|---|
| Eligible pool (per UF & region) | `modeled` | real DataSUS per-UF estimate |
| Competing trials | `registry_gov` when live, else `modeled` LOW | CT.gov + ReBEC — **the seal flips on real availability** |
| Supply/demand ratio | `modeled` | pool ÷ trials |

### §5 Site rankings · §6 Site deep-dive
| Component | Seal | Backend |
|---|---|---|
| Eligible pool | `modeled` | UF DataSUS total (real) × PI-share (modeled) |
| Infra fit | `modeled` (HIGH when CNES-verified) | CNES equipment / deep-web infra |
| Data quality | `modeled` | real ANVISA/FDA/EMA inspection flag |
| KOL strength | `modeled` | KOL score (see §7) |
| Screen-fail / retention | `modeled` LOW ("not declared") | site declaration (absent for public sites) |
| Composite + confidence | `modeled` | confidence = # of 3 signals present (declaration+SFQ, PI history, publicly-verifiable pool) |

### §7 KOL map (Brazil tile-map)
| Figure | Seal | Backend |
|---|---|---|
| Per-state investigator density | derived from `registry_gov` | CT.gov site records matched to directory CNES/UF |
| Publications / society / guideline | `modeled` + `sourceRefs` | Parallel deep-web research (citation URLs attached) |
| KOL score | `modeled` | trials × pubs × society × CNES link |

### §8 Risk register & provenance
Renders the **provenance index** — a live count of every metric on the page by seal
(`buildProvenanceIndex`), so the sponsor sees the exact mix (e.g. "473 modeled · 10
registry · 3 peer-reviewed"). This is the report auditing itself.

## Honesty audit — verdict

- ✅ **Real vs. modeled is not blurred.** Only genuinely-real counts (DataSUS base cohort,
  CT.gov trial counts, ANVISA inspection facts, cited constants) get `registry`/`peer_reviewed`.
  Everything computed — including estimates *over* real bases — is `modeled`.
- ✅ **Seals flip on real availability.** Competing trials are `registry` only when CT.gov
  is actually live; otherwise a `modeled` LOW placeholder. The DataSUS pool falls back to
  synthetic (labelled) when the estimator is offline.
- ✅ **Missing data is never fabricated** — it renders as `modeled` LOW with a "not declared"
  note, or "—".
- ✅ **Vendor figures stay `vendor_benchmark`**, never dressed as peer-reviewed.
- ⚠️ **Known modeled placeholders** (honestly sealed, but not yet real): country
  infrastructure site-count (70, demo estimate) and the per-site pool *share* (PI-count
  proxy over the real UF total). These lift to real data as the CNES/RNPC and site-declaration
  connectors land.

**Bottom line:** the seals are trustworthy — a sponsor can read `registry`/`peer_reviewed`
as fact and `modeled` as TrialBridge's estimate, and the split is enforced by the build-time
provenance gate, not by editorial discipline alone.
