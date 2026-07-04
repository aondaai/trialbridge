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
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Patient } from "../src/lib/matcher/types";
import { canonicalizeLab } from "../src/lib/matcher/units";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

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

const OTHER_CANCERS = ["lung cancer", "colorectal cancer", "gastric cancer", "ovarian cancer"];

function makePatient(rng: RNG, site: SiteConfig, i: number): Patient {
  const isBreast = chance(rng, site.breastShare);
  const diagnosis = isBreast ? "breast cancer" : weighted(rng, OTHER_CANCERS.map((c) => [c, 1] as [string, number]));

  // Stage: this is an mBC-oriented panel → enriched for stage IV.
  const stage = weighted<string>(rng, [
    ["IV", 0.55],
    ["III", 0.25],
    ["II", 0.15],
    ["I", 0.05],
  ]);

  // prior_lines correlated with stage (metastatic patients have prior therapy).
  let priorLines: number | null;
  if (stage === "IV") priorLines = weighted<number>(rng, [[0, 0.12], [1, 0.34], [2, 0.3], [3, 0.16], [4, 0.08]]);
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

  const ecog = weighted<number>(rng, [[0, 0.35], [1, 0.45], [2, 0.15], [3, 0.05]]);

  const brain = weighted<string | null>(rng, [
    ["absent", 0.7],
    ["present", 0.08],
    [null, 0.22], // missing → exclusion-unknown (D3)
  ]);

  const age = Math.round(normal(rng, 58, 12, 28, 86, 0));
  const sex = chance(rng, 0.98) ? "F" : "M";

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
    biomarkers: { her2_status: her2, er_status: er, pr_status: pr, brain_metastases: brain },
    priorLines,
    ecog,
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

function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const index: { id: string; name: string; country: string; city: string; persona: string; monthlyIncidence: number; count: number; file: string }[] = [];

  for (const site of SITES) {
    const rng = mulberry32(site.seed);
    const patients: Patient[] = [];
    for (let i = 0; i < site.n; i++) patients.push(makePatient(rng, site, i));

    const file = `${site.id}.json`;
    const payload = {
      site: {
        id: site.id,
        name: site.name,
        country: site.country,
        city: site.city,
        persona: site.persona,
        monthlyIncidence: site.monthlyIncidence,
      },
      generatedWith: { seed: site.seed, generator: "programmatic-mulberry32", note: "population calibrated to breast-oncology epidemiology; NOT fit to protocol criteria" },
      patients,
    };
    writeFileSync(resolve(DATA_DIR, file), JSON.stringify(payload, null, 2) + "\n");

    // quick summary
    const her2Missing = patients.filter((p) => p.biomarkers.her2_status == null).length;
    const her2Pos = patients.filter((p) => p.biomarkers.her2_status === "positive").length;
    index.push({ id: site.id, name: site.name, country: site.country, city: site.city, persona: site.persona, monthlyIncidence: site.monthlyIncidence, count: patients.length, file });
    console.log(
      `${site.id}: ${patients.length} patients | HER2 missing ${her2Missing} (${Math.round((100 * her2Missing) / patients.length)}%) | HER2+ ${her2Pos}`,
    );
  }

  writeFileSync(resolve(DATA_DIR, "index.json"), JSON.stringify({ sites: index }, null, 2) + "\n");
  console.log(`\nWrote ${index.length} site datasets + index.json to data/`);
}

main();
