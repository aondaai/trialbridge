/**
 * `npm run demo` — the headless proof that the whole engine works end-to-end on
 * the seeded data and hero protocol. Everything the sponsor sees on screen is
 * printed here from the same service-layer code path.
 *
 * Prints:
 *  1. Per-site tri-state counts (definite / possible / excluded)      [D1]
 *  2. Cross-site aggregate (counts-only, <5 suppression)              [privacy]
 *  3. Hero-criterion (HER2) softening split                          [D2]
 *  4. Funnel-discounted, rate-aware deliverable estimate             [R1/R2]
 *  5. A rare-subgroup slice where <5 suppression visibly fires       [privacy]
 *  6. HER2 missingness among breast patients                         [R3]
 */

import { HERO_CRITERIA, HERO_META } from "../src/data/hero-protocol";
import {
  evaluateAllSites,
  aggregateView,
  combinedSoftening,
  combinedBottlenecks,
  siteFeasibility,
  suppressionSlice,
  biomarkerMissingnessAmongBreast,
} from "../src/lib/service";

function hr(title: string) {
  console.log("\n" + "─".repeat(72));
  console.log(title);
  console.log("─".repeat(72));
}

function main() {
  console.log("TrialBridge (Elegível) — demo proof");
  console.log(`Hero protocol: ${HERO_META.title}`);
  console.log(`Reference: ${HERO_META.nct} (${HERO_META.sourceNote})`);

  const sites = evaluateAllSites(HERO_CRITERIA);

  // 1. Per-site tri-state counts
  hr("1. PER-SITE TRI-STATE COHORTS  [definite = passes all · possible = has unknowns · excluded]");
  for (const s of sites) {
    const c = s.counts;
    console.log(
      `  ${s.meta.name.padEnd(42)} n=${String(c.total).padStart(3)}  ` +
        `definite=${String(c.definite).padStart(3)}  possible=${String(c.possible).padStart(3)}  excluded=${String(c.excluded).padStart(3)}`,
    );
  }

  // 2. Cross-site aggregate (counts-only + suppression)
  hr("2. SPONSOR AGGREGATE  (counts only — never patient rows; cells 1–4 → \"<5\")");
  const agg = aggregateView(sites);
  for (const row of agg.perSite) {
    console.log(
      `  ${row.siteName.padEnd(42)} definite=${String(row.definite).padStart(4)}  possible=${String(row.possible).padStart(4)}  candidates=${String(row.candidates).padStart(4)}`,
    );
  }
  console.log(
    `  ${"TOTAL (all responding sites)".padEnd(42)} definite=${String(agg.totalDefinite).padStart(4)}  possible=${String(agg.totalPossible).padStart(4)}  candidates=${String(agg.totalCandidates).padStart(4)}`,
  );

  // 3. Bottleneck + hero softening split
  hr("3. BOTTLENECK + PROTOCOL SOFTENING  (relax one criterion, re-score the pool)");
  const ranked = combinedBottlenecks(sites, HERO_CRITERIA);
  console.log("  Bottlenecks ranked by pool freed if relaxed:");
  for (const r of ranked.slice(0, 4)) {
    console.log(`    · ${r.label.padEnd(46)} +${r.newlyDefinite} definite, +${r.newlyPossible} possible`);
  }

  const hero = combinedSoftening(sites, HERO_CRITERIA, HERO_META.heroBottleneckHandle);
  console.log(`\n  HERO: relax "${hero.label}"`);
  console.log(`    baseline definite pool : ${hero.baseline.definite}`);
  console.log(`    relaxed  definite pool : ${hero.relaxed.definite}   (Δ +${hero.relaxed.definite - hero.baseline.definite})`);
  console.log(`    ├─ genuinely newly eligible (were FAILING HER2, e.g. HER2-negative/low): ${hero.newlyDefiniteFromFail}`);
  console.log(`    └─ CAVEAT: "newly definite" only because HER2 was UNKNOWN (unproven): ${hero.newlyDefiniteFromUnknown}`);
  console.log(`    also newly POSSIBLE (were excluded, still carry other unknowns): ${hero.newlyPossible}`);

  // 4. Funnel-discounted, rate-aware deliverable estimate
  hr("4. DELIVERABLE ESTIMATE  (R1 funnel ×0.3 · R2 incident rate over 6 months — NOT the raw count)");
  let totalEnrollable = 0;
  let totalScreening = 0;
  for (const s of sites) {
    const f = siteFeasibility(s, 6);
    totalEnrollable += f.enrollableEstimate;
    totalScreening += f.screeningPool;
    console.log(
      `  ${s.meta.name.padEnd(42)} screening_pool=${String(f.screeningPool).padStart(3)}  ` +
        `+incident(6mo)=${String(f.incidentOverWindow).padStart(3)}  → ~${f.enrollableEstimate} enrollable`,
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(42)} screening_pool=${String(totalScreening).padStart(3)}  → ~${totalEnrollable} enrollable over 6 months  (match ≠ enrollable)`,
  );

  // 5. Suppression demo — the confirmed-eligible (definite) subgroup is so small
  //    per site that the sponsor view cannot reveal the exact number.
  hr("5. PRIVACY — small-cell suppression fires on the confirmed-eligible subgroup");
  console.log("  Confirmed-eligible (definite) candidates per site — cells 1–4 → \"<5\":");
  let fired = false;
  for (let i = 0; i < sites.length; i++) {
    const raw = sites[i].counts.definite;
    const shown = agg.perSite[i].definite;
    if (shown === "<5") fired = true;
    const shownStr = shown === "<5" ? "<5 (suppressed)" : String(shown);
    console.log(`    ${sites[i].meta.name.padEnd(42)} raw=${String(raw).padStart(2)}  shown=${shownStr}`);
  }
  // Secondary illustration: a rare biomarker subgroup, if any lands 1–4.
  const eqSlice = suppressionSlice(sites, "her2_status", "equivocal");
  const eqFired = eqSlice.some((r) => r.candidates === "<5");
  console.log(`  → suppression visibly fired: ${fired ? "YES" : "NO"}` + (eqFired ? " (also on HER2-equivocal subgroup)" : ""));

  // 6. R3 missingness evidence
  hr("6. DATA REALISM — HER2 missingness among breast-cancer patients (R3 target 30–40%)");
  for (const m of biomarkerMissingnessAmongBreast(sites)) {
    console.log(`  ${m.siteName.padEnd(42)} breast=${String(m.breast).padStart(3)}  HER2 unknown=${String(m.missing).padStart(3)} (${m.pct}%)`);
  }

  console.log("\n" + "═".repeat(72));
  console.log("DEMO OK — tri-state counts, softening split, and funnel-discounted estimate above.");
  console.log("═".repeat(72));
}

main();
