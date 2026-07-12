/**
 * Boot-time demo seed — makes a fresh deploy come up with the two-sided flow ready.
 *
 * The cloud instance runs on Render's EPHEMERAL disk: `prisma db push` recreates
 * an empty SQLite database on every deploy, which is why the /site (Camila) and
 * /sponsor (Marcus) screens render their "nothing here yet" fallbacks after each
 * redeploy. This script populates the demo's known-good starting state so the
 * flow is walkable the moment the instance boots — without hand-listing a site
 * and re-posting the protocol every time.
 *
 * What it seeds (all from committed, deterministic sources — no API key, no clock
 * dependence for the data itself):
 *   1. All demo sites + their patients, from generatePanel() (fixed-seed PRNG, the
 *      same data `npm run generate-data` writes to data/*.json).
 *   2. The hero consultation (HERO_META / HERO_CRITERIA / HERO_PROTOCOL_TEXT).
 *   3. Pre-seeded counts-not-rows Responses for sites B & C (the app treats site-a
 *      — Camila — as the ONE live submit, so it is intentionally left un-submitted
 *      so her "Submit proof of capacity" click is still the live moment on stage).
 *
 * IDEMPOTENT + NON-DESTRUCTIVE: if the hero consultation and site-a already exist,
 * the script exits without touching anything, so re-running it (or a warm restart
 * that kept the disk) never clobbers a response Camila submitted live. Run with
 * `npm run db:seed-demo`.
 */

import { generatePanel } from "./generate-data";
import { upsertSite, replacePatients, loadSite } from "../src/lib/data/sites";
import { getConsultation, writeConsultations, hasResponded, upsertResponse } from "../src/lib/store";
import type { StoredConsultation, StoredResponse } from "../src/lib/store";
import { HERO_META, HERO_CRITERIA, HERO_PROTOCOL_TEXT } from "../src/data/hero-protocol";
import { evaluateCohort, countCohorts } from "../src/lib/matcher/engine";
import { rankBottlenecks } from "../src/lib/matcher/soften";

// Camila's site — the one live submit. Everything else is pre-seeded.
const LIVE_SITE_ID = "site-a";

// Fixed timestamps so the seeded state is byte-stable across runs (clock-free):
// records are created live by real users in production; the demo baseline is not.
const CREATED_AT = "2026-07-01T00:00:00Z";
const RESPONDED_AT = "2026-07-02T00:00:00Z";

const HERO_CONSULTATION: StoredConsultation = {
  id: HERO_META.id,
  sponsorName: HERO_META.sponsorName,
  title: HERO_META.title,
  nct: HERO_META.nct,
  sourceNote: HERO_META.sourceNote,
  protocolText: HERO_PROTOCOL_TEXT,
  criteria: HERO_CRITERIA,
  heroBottleneckHandle: HERO_META.heroBottleneckHandle,
  createdAt: CREATED_AT,
};

async function main() {
  // Non-destructive guard: if the baseline is already present, do nothing. This
  // keeps warm restarts (same disk) from wiping a live-submitted response.
  const existingConsultation = await getConsultation(HERO_CONSULTATION.id);
  const existingSite = await loadSite(LIVE_SITE_ID);
  if (existingConsultation && existingSite) {
    console.log("[seed-demo] baseline already present — leaving live state untouched.");
    return;
  }

  // The hero consultation is written LAST, on purpose: it is the sentinel the
  // idempotency guard above checks (`consultation && site-a`). Writing it only
  // after sites, patients, and the B/C responses are all in place means a run
  // that is killed mid-seed leaves NO consultation, so the next run re-seeds
  // fully rather than short-circuiting on a half-populated database.

  // 1. Sites + patients (deterministic; the same panel generate-data writes to JSON).
  const panel = generatePanel();
  for (const { site, patients } of panel) {
    await upsertSite(site);
    await replacePatients(site.id, patients);
    console.log(`[seed-demo] site ${site.id}: ${patients.length} patients`);
  }

  // 2. Pre-seed Responses for every site EXCEPT Camila's (site-a stays live).
  //    Mirrors src/app/site/actions.ts::submitCapacity, with live=false.
  for (const { site } of panel) {
    if (site.id === LIVE_SITE_ID) continue;
    if (await hasResponded(HERO_CONSULTATION.id, site.id)) continue;

    const ds = await loadSite(site.id);
    if (!ds) continue;
    const evals = evaluateCohort(ds.patients, HERO_CONSULTATION.criteria);
    const counts = countCohorts(evals);
    const top = rankBottlenecks(ds.patients, HERO_CONSULTATION.criteria)[0];

    const resp: StoredResponse = {
      id: `resp-${HERO_CONSULTATION.id}-${site.id}`,
      consultationId: HERO_CONSULTATION.id,
      siteId: site.id,
      siteName: ds.site.name,
      definite: counts.definite,
      possible: counts.possible,
      excluded: counts.excluded,
      total: counts.total,
      bottleneckHandle: top?.handle ?? null,
      bottleneckLabel: top?.label ?? null,
      monthlyIncidence: ds.site.monthlyIncidence,
      live: false,
      submittedAt: RESPONDED_AT,
    };
    await upsertResponse(resp);
    console.log(`[seed-demo] pre-seeded response for ${site.id} (definite=${counts.definite})`);
  }

  // 3. The hero consultation — the commit marker (see note at the top of main()).
  await writeConsultations([HERO_CONSULTATION]);
  console.log(`[seed-demo] consultation ${HERO_CONSULTATION.id} posted`);

  console.log("[seed-demo] done — Camila's /site flow and the /sponsor board are ready.");
}

main()
  .then(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[seed-demo] failed:", e);
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
    process.exit(1);
  });
