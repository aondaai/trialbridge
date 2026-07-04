/**
 * Seed the marketplace snapshot (F013).
 *
 * Writes:
 *  - data/consultations.json : the one hero consultation (Marcus's posting).
 *  - data/responses.json     : sites B and C PRE-SEEDED as already-responded
 *                              (counts-not-rows). Site A (Camila) is intentionally
 *                              left unresponded — she submits live in the UI, so
 *                              the demo shows the two-sided loop closing without
 *                              building live posting/discovery plumbing.
 *
 * Run: npm run db:seed
 */

import { HERO_CRITERIA, HERO_META, HERO_PROTOCOL_TEXT } from "../src/data/hero-protocol";
import { loadAllSites } from "../src/lib/data/sites";
import { evaluateCohort, countCohorts } from "../src/lib/matcher/engine";
import { rankBottlenecks } from "../src/lib/matcher/soften";
import { writeConsultations, writeResponses, StoredConsultation, StoredResponse } from "../src/lib/store";

// Fixed timestamps so the seed is deterministic and the snapshot is stable.
const CREATED_AT = "2026-07-06T09:00:00.000Z";
const RESPONDED_AT = "2026-07-06T14:30:00.000Z";

/** Sites pre-seeded as already-responded (everything except Camila's site-a). */
const PRESEEDED_SITE_IDS = new Set(["site-b", "site-c"]);

function main() {
  const consultation: StoredConsultation = {
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
  writeConsultations([consultation]);

  const responses: StoredResponse[] = [];
  for (const ds of loadAllSites()) {
    if (!PRESEEDED_SITE_IDS.has(ds.site.id)) continue;
    const evals = evaluateCohort(ds.patients, HERO_CRITERIA);
    const counts = countCohorts(evals);
    const top = rankBottlenecks(ds.patients, HERO_CRITERIA)[0];
    responses.push({
      id: `resp-${consultation.id}-${ds.site.id}`,
      consultationId: consultation.id,
      siteId: ds.site.id,
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
    });
  }
  writeResponses(responses);

  console.log(`Seeded 1 consultation (${consultation.id}).`);
  console.log(`Pre-seeded ${responses.length} responses: ${responses.map((r) => r.siteId).join(", ")}.`);
  console.log("Site-a (Camila) intentionally left to submit live in the UI.");
}

main();
