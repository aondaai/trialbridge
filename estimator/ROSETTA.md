# Rosetta Stone (Trilha B, step 1) — grounding, verdict, and the route that unblocks step 3

**Status:** investigated 2026-07-11. **Verdict: person-level A1↔A2 record linkage is infeasible
with the current assets AND not required to calibrate.** Recommended path pivots step 3 to
*aggregate / external-anchor* calibration, which needs **no PII linkage and no DPO gate**. The
DPO-gated record-linkage path is kept as a documented fallback for spot-check validation only.

## Why the original framing (person-level A1↔A2 linkage) doesn't work here

Calibration/step 3 needs, per UF × stratum, the TRUE depth-pass rate in the DataSUS target
population. The original idea was to link the same patient across A1 (DataSUS) and A2
(proprietary) to get (predicted, true) pairs in the target. Grounding the two sources
(privacy-preserving, aggregate-only recon — no PII displayed):

| | A1 — DataSUS OMOP (`person`) | A2 — proprietary (parquet) |
|---|---|---|
| Structured identifier | `person_source_value` = **36-char UUID** (opaque; OMOP dropped the original CNS/CPF) | `unique_patient_id` = `<hospital>_<n>` (**source-internal**) |
| Demographics | full DOB, gender, `location_uf_value` | **birth YEAR only**, gender, hospital |
| Strong IDs (CNS/CPF) | none (replaced by UUID) | in **free text only**, and rare: **CNS-15 in 0.1%**, CPF in 0.4% of docs |

**Consequences:**
1. **No shared key.** A1's UUID and A2's internal id are unrelated.
2. **Deterministic CNS/CPF-hash linkage would cover <1%** of A2 (identifiers extractable from
   text that rarely contains them), and A1 would need the **raw DataSUS** (SIH/SIA, pre-OMOP)
   that still carries CNS — a separate, larger pull. Not viable at scale.
3. **Probabilistic linkage is too weak:** A2's quasi-identifiers reduce to birth-YEAR + gender +
   UF — far too little discriminating power for reliable person matching.

## The key reframe — you don't need person linkage to calibrate

The estimator already splits the work: **A1 supplies the base cohort (denominators); A2 supplies
the depth rate (numerator fraction).** What step 3 must establish is not "is this the same
person" but **"is A2's depth rate representative of the A1 population, per UF × stratum."** That
is an *aggregate representativeness* question, answerable with **group-level anchors**, not
record linkage:

- **External epidemiological anchors (the parked INCA route becomes central):** per-UF /
  national published rates for the depth criteria — HER2+ prevalence, ECOG distribution,
  metastatic-at-diagnosis fraction in Brazilian breast cancer (INCA estimates, registries,
  literature). Calibrate the proprietary rate against these aggregate anchors per stratum.
- **Direct standardization (already in the estimator)** removes the population-mix difference;
  what remains is a per-criterion *level* correction — exactly what an aggregate anchor fixes,
  and exactly the gap LOUO already quantified (ECOG 0.19, metastatic 0.10).

This is **ecological calibration**: coarser than person-level, but it needs no sensitive-data
linkage, no DPO sign-off, and matches step 3's own "external epi benchmark" clause. It is the
recommended unblocker.

## Recommended path for step 3 (no DPO gate)

1. Assemble an **anchor table**: per criterion (HER2+, ECOG≤1, metastatic), a target-population
   rate per UF (or national, if per-UF unavailable) from INCA / registries / literature, with
   source + confidence per cell (same provenance discipline as `hospital-uf.json`).
2. **Calibrate** the proprietary per-stratum depth rate against the anchor (the existing
   `calibration.py` Platt/isotonic, fit on aggregate anchor points instead of person pairs).
3. A UF is **"calibrated"** when it has a usable anchor for the driving criteria → drives
   `CalibratedCoverage.from_model`; flip `_COVERAGE_IS_CALIBRATED`.
4. Drift (step 4) = re-checking anchors over time.

## Fallback (DPO-gated) — record linkage as a spot-check only

If person-level validation is later wanted on the <1% CNS-bearing subset: extract CNS from A2
text (NLP), obtain raw DataSUS CNS, join on a **salted hash of CNS** (each source hashes with a
shared secret salt; only hashes are compared — pseudonymization-at-source, LGPD data
minimization). This needs DPO/LGPD sign-off and is worth it only as a small validation sample,
NOT as the calibration substrate.

## What the data owner should decide

- **Proceed with aggregate/external-anchor calibration (recommended)** → I can start assembling
  the INCA anchor table and wiring it into `calibration.py`. This is the INCA route, now load-bearing.
- Or **pursue the DPO-gated CNS spot-check** in parallel (needs legal sign-off first).
