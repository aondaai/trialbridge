/**
 * Hybrid synthetic-data generator (F008) — the real Monday risk, per the red-team.
 *
 * A pure-LLM patient dump is distributionally flat and clinically incoherent
 * (weak stage↔prior-line and biomarker↔tumor-type correlations, nonsense combos).
 * Instead we sample PROGRAMMATICALLY from realistic marginal prevalences with
 * explicit correlations, and use a fixed seed so the datasets are reproducible and
 * committable. (No LLM call here → the generator is offline and deterministic;
 * "LLM for flavor only" is reserved for cosmetic free-text we don't need for the
 * matcher.)
 *
 * Honest calibration (D / ADR): the POPULATION is calibrated to a breast-oncology
 * clinic with real HER2 prevalence and realistic missingness — we do NOT hand-fit
 * individual records to the hero criteria. The sampler never reads the protocol.
 *
 * R3: ~30–40% of HER2 values are missing (site-dependent), so the softenable
 * biomarker actually exercises the unknown path and the pool isn't suspiciously clean.
 * D5: labs are sampled in each site's native units, then canonicalized at seed time.
 *
 * NSCLC/KRAS-G12C scenario fields (kras_g12c, pdl1_status, histology, mi_recent,
 * prior_kras_inhibitor) are drawn from a SECOND, independently seeded RNG stream
 * per site (`lungRng`), used only inside the `isLung` branch. This is deliberate:
 * the shared `rng` stream drives every existing (breast-scenario) draw in a fixed
 * sequence, and inserting new conditional draws into that stream would shift every
 * subsequent patient's record, silently invalidating the HER2 numbers already
 * pinned in DEMO.md/progress.md. A dedicated stream keeps breast-patient output
 * byte-identical across regeneration.
 *
 * PURE MODULE (no file I/O): this holds the in-memory generator so it can be
 * bundled into the Next.js server (the boot-time demo seed imports generatePanel
 * here). The file-writing CLI wrapper lives in scripts/generate-data.ts, which
 * imports generatePanel from this module — keeping node:fs out of the app bundle.
 */

import type { Patient } from "@/lib/matcher/types";
import type { SiteMeta } from "@/lib/data/sites";
import { canonicalizeLab } from "@/lib/matcher/units";

// ---------- seeded PRNG (mulberry32) ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RNG = () => number;

function weighted<T>(rng: RNG, entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) {
    if ((r -= w) <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

/** Box–Muller normal, clamped to [lo, hi] and rounded to `dp` decimals. */
function normal(rng: RNG, mean: number, sd: number, lo: number, hi: number, dp = 1): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const x = Math.min(hi, Math.max(lo, mean + z * sd));
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function chance(rng: RNG, p: number): boolean {
  return rng() < p;
}

// ---------- site configuration ----------
interface SiteConfig {
  id: string;
  name: string;
  country: string;
  city: string;
  /** Brazilian macro-region — drives the regional breakdown. */
  region: string;
  persona: string;
  monthlyIncidence: number; // R2: nominal new eligible breast-mets patients / month
  n: number;
  breastShare: number; // fraction of the panel that is breast cancer
  her2MissingRate: number; // R3
  creatUnit: "mg/dL" | "umol/L"; // D5: site-native lab units
  hgbUnit: "g/dL" | "g/L";
  seed: number;
}

const SITES: SiteConfig[] = [
  {
    id: "site-a",
    name: "Hospital Bandeirantes Oncology Network",
    country: "BR",
    city: "São Paulo",
    region: "Sudeste",
    persona: "Dra. Camila Rocha — large academic network (submits live)",
    monthlyIncidence: 9,
    n: 220,
    breastShare: 0.85,
    her2MissingRate: 0.35,
    creatUnit: "mg/dL",
    hgbUnit: "g/dL",
    seed: 1010,
  },
  {
    id: "site-b",
    name: "Instituto Sul de Oncologia",
    country: "BR",
    city: "Porto Alegre",
    region: "Sul",
    persona: "Regional network (pre-seeded response)",
    monthlyIncidence: 5,
    n: 185,
    breastShare: 0.78,
    her2MissingRate: 0.4,
    // Different lab system → different units. Exercises D5 across sites.
    creatUnit: "umol/L",
    hgbUnit: "g/L",
    seed: 2020,
  },
  {
    id: "site-c",
    name: "Clínica Norte Câncer",
    country: "BR",
    city: "Recife",
    region: "Nordeste",
    persona: "Community clinic (pre-seeded response)",
    monthlyIncidence: 3,
    n: 150,
    breastShare: 0.62,
    her2MissingRate: 0.4,
    creatUnit: "mg/dL",
    hgbUnit: "g/dL",
    seed: 3030,
  },
];

// Weighted (not equal) so the NSCLC/KRAS-G12C scenario has a meaningful
// addressable pool within the existing 3 sites — still a single weighted()
// call either way, so this reweighting doesn't shift the RNG stream position
// (see the RNG-safety note above); it only changes which label a given
// non-breast patient gets.
const OTHER_CANCERS: [string, number][] = [
  ["lung cancer", 12],
  ["colorectal cancer", 1],
  ["gastric cancer", 1],
  ["ovarian cancer", 1],
];

function makePatient(rng: RNG, site: SiteConfig, i: number, lungRng: RNG): Patient {
  const isBreast = chance(rng, site.breastShare);
  const diagnosis = isBreast ? "breast cancer" : weighted(rng, OTHER_CANCERS);
  const isLung = diagnosis === "lung cancer";

  // Stage: enriched for stage IV — for breast this reflects an mBC-oriented
  // panel; for lung it reflects screening specifically for a 1L ADVANCED-NSCLC
  // trial (this population isn't a general lung-cancer census). Branching the
  // table (not adding a call) keeps the RNG stream position unaffected.
  const stage = isLung
    ? weighted<string>(rng, [
        ["IV", 0.78],
        ["III", 0.16],
        ["II", 0.04],
        ["I", 0.02],
      ])
    : weighted<string>(rng, [
        ["IV", 0.55],
        ["III", 0.25],
        ["II", 0.15],
        ["I", 0.05],
      ]);

  // prior_lines: correlated with stage for the breast/2L-shaped population,
  // but the NSCLC scenario is a 1L trial (most patients treatment-naive in
  // the advanced/metastatic setting) — branch the WEIGHT TABLE by diagnosis.
  // Still exactly one weighted() call either way, so the RNG stream position
  // is unaffected by which table backs it (see RNG-safety note above).
  let priorLines: number | null;
  if (isLung) {
    priorLines =
      stage === "IV"
        ? weighted<number>(rng, [[0, 0.8], [1, 0.15], [2, 0.04], [3, 0.01]])
        : weighted<number>(rng, [[0, 0.95], [1, 0.05]]);
  } else if (stage === "IV") priorLines = weighted<number>(rng, [[0, 0.12], [1, 0.34], [2, 0.3], [3, 0.16], [4, 0.08]]);
  else if (stage === "III") priorLines = weighted<number>(rng, [[0, 0.6], [1, 0.3], [2, 0.1]]);
  else priorLines = weighted<number>(rng, [[0, 0.85], [1, 0.15]]);
  if (chance(rng, 0.05)) priorLines = null; // occasional missing

  // HER2 status: real-world breast prevalence, then apply missingness (R3).
  // Non-breast tumors don't carry a HER2 breast assay → null (unknown).
  let her2: string | null = null;
  if (isBreast) {
    her2 = weighted<string>(rng, [
      ["positive", 0.18],
      ["negative", 0.55],
      ["low", 0.24],
      ["equivocal", 0.03],
    ]);
    if (chance(rng, site.her2MissingRate)) her2 = null; // R3 missingness
  }

  // Hormone receptors (flavor + realism; correlated, not used by hero criteria).
  const tripleNegish = her2 === "negative" && chance(rng, 0.25);
  const er = tripleNegish ? "negative" : weighted<string>(rng, [["positive", 0.7], ["negative", 0.3]]);
  const pr = er === "positive" ? weighted<string>(rng, [["positive", 0.8], ["negative", 0.2]]) : "negative";

  // Drawn unconditionally (same call, same weights) for every patient so the
  // RNG stream position never depends on diagnosis; NSCLC's ECOG is instead
  // overridden to null below — a genuinely different missingness pattern
  // (structurally never coded, not a probability) from the discard pattern.
  const ecog = weighted<number>(rng, [[0, 0.35], [1, 0.45], [2, 0.15], [3, 0.05]]);

  const brain = weighted<string | null>(rng, [
    ["absent", 0.7],
    ["present", 0.08],
    [null, 0.22], // missing → exclusion-unknown (D3)
  ]);

  const age = Math.round(normal(rng, 58, 12, 28, 86, 0));
  const sex = chance(rng, 0.98) ? "F" : "M";

  // ---- NSCLC/KRAS-G12C scenario fields — drawn from the independent lungRng
  // stream, only for lung-cancer patients (see RNG-safety note at file top). ----
  let histology: string | null = null;
  let krasG12c: string | null = null;
  let pdl1Status: string | null = null;
  let miRecent: string | null = null;
  let priorKrasInhibitor: string | null = null;

  if (isLung) {
    // PARTIAL — nonsquamous vs squamous/mixed, ~18% missing.
    histology = weighted<string | null>(lungRng, [
      ["nonsquamous", 0.75],
      ["squamous", 0.12],
      ["mixed/neuroendocrine", 0.02],
      [null, 0.18],
    ]);

    // NOT EVALUABLE (high-missing, not literal-100%) — only a minority of
    // patients have documented NGS/IHC results. This IS the "testing gap"
    // the demo narrates: ~78% untested, not a flat 100%. Tested patients
    // skew somewhat toward qualifying (this site-EHR population is a
    // simplification, not the cited macro prevalence — see
    // modeledPrevalence.ts for the epidemiologically-cited layer).
    krasG12c = chance(lungRng, 0.28)
      ? weighted<string>(lungRng, [["positive", 0.4], ["negative", 0.6]])
      : null;
    pdl1Status = chance(lungRng, 0.28)
      ? weighted<string>(lungRng, [["negative", 0.4], ["low", 0.35], ["high", 0.25]])
      : null;

    // PASS-able — ICD-coded conditions are well captured (~8% missing).
    miRecent = chance(lungRng, 0.92)
      ? weighted<string>(lungRng, [["absent", 0.92], ["present", 0.08]])
      : null;

    // PARTIAL — high-cost drug capture (~30% missing).
    priorKrasInhibitor = chance(lungRng, 0.7)
      ? weighted<string>(lungRng, [["absent", 0.97], ["present", 0.03]])
      : null;
  }

  // ---- labs in the site's native units, then canonicalize at seed time (D5) ----
  const labs: Patient["labs"] = {};

  // creatinine (canonical mg/dL). Native mg/dL ~0.9±0.3; convert if µmol/L.
  labs.creatinine = maybeLab(rng, 0.12, () => {
    const mgdl = normal(rng, 0.9, 0.35, 0.4, 3.2, 2);
    const raw = site.creatUnit === "umol/L" ? { value: Math.round(mgdl * 88.42), unit: "umol/L" } : { value: mgdl, unit: "mg/dL" };
    return canon("creatinine", raw.value, raw.unit);
  });

  // hemoglobin (canonical g/dL). Native g/dL ~12±2; convert if g/L.
  labs.hemoglobin = maybeLab(rng, 0.1, () => {
    const gdl = normal(rng, 12, 2, 6.5, 16, 1);
    const raw = site.hgbUnit === "g/L" ? { value: Math.round(gdl * 10), unit: "g/L" } : { value: gdl, unit: "g/dL" };
    return canon("hemoglobin", raw.value, raw.unit);
  });

  labs.platelets = maybeLab(rng, 0.1, () => canon("platelets", normal(rng, 240, 70, 40, 480, 0), "10^9/L"));
  labs.bilirubin = maybeLab(rng, 0.13, () => canon("bilirubin", normal(rng, 0.6, 0.3, 0.2, 3.0, 2), "mg/dL"));
  labs.ejection_fraction = maybeLab(rng, 0.18, () => ({ value: Math.round(normal(rng, 60, 7, 35, 72, 0)), unit: "%" }));

  return {
    id: `${site.id}-p${String(i + 1).padStart(3, "0")}`,
    siteId: site.id,
    diagnosis,
    stage,
    biomarkers: {
      her2_status: her2,
      er_status: er,
      pr_status: pr,
      brain_metastases: brain,
      histology,
      kras_g12c: krasG12c,
      pdl1_status: pdl1Status,
      mi_recent: miRecent,
      prior_kras_inhibitor: priorKrasInhibitor,
    },
    priorLines,
    // NOT EVALUABLE for NSCLC — structurally uncodeable, not a probability.
    ecog: isLung ? null : ecog,
    labs,
    sex,
    age,
  };
}

function maybeLab(rng: RNG, missingRate: number, make: () => { value: number; unit: string }) {
  return chance(rng, missingRate) ? null : make();
}

function canon(field: string, value: number, unit: string) {
  const c = canonicalizeLab(field, value, unit);
  return { value: Math.round(c.value * 100) / 100, unit: c.unit };
}

/**
 * Build the synthetic panel IN MEMORY (no file I/O). Reusable by tests, by the
 * boot-time demo seed, and by any "load sample data" upload flow. Deterministic
 * (fixed per-site seeds).
 */
export function generatePanel(): { site: SiteMeta; patients: Patient[] }[] {
  return SITES.map((site) => {
    const rng = mulberry32(site.seed);
    const lungRng = mulberry32(site.seed + 9000);
    const patients: Patient[] = [];
    for (let i = 0; i < site.n; i++) patients.push(makePatient(rng, site, i, lungRng));
    return {
      site: {
        id: site.id,
        name: site.name,
        country: site.country,
        city: site.city,
        region: site.region,
        persona: site.persona,
        monthlyIncidence: site.monthlyIncidence,
      },
      patients,
    };
  });
}
