/**
 * Precompute KOL enrichment via the Parallel Task API and write it to the store the
 * report reads. Run out-of-band (the deep research is ~1 min/physician), e.g. on a
 * schedule or before a demo:
 *
 *   npm run enrich-kols -- "breast cancer" 8
 *
 * Needs PARALLEL_API_KEY in .env.local (loaded below; a standalone script must, whereas
 * Next loads it automatically). Idempotent: merges into data/kol-enrichment.json.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

import { fetchCompetition } from "@/lib/ctgov/competition";
import { ctgovToKolInputs } from "@/lib/report/buildReport";
import { enrichInvestigators } from "@/lib/kol/enrich";
import { mergeIntoStore } from "@/lib/kol/enrichmentStore";
import { parallelEnabled } from "@/lib/parallel/client";

async function main() {
  const condition = process.argv[2] ?? "breast cancer";
  const n = Number(process.argv[3] ?? 8);
  if (!parallelEnabled()) {
    console.error("PARALLEL_API_KEY not set in .env.local — nothing to do.");
    process.exit(1);
  }
  console.log(`[enrich-kols] condition="${condition}" top ${n} investigators`);

  const competition = await fetchCompetition(condition, { pageSize: 200 });
  if (competition.source !== "live") {
    console.error("[enrich-kols] CT.gov unavailable:", competition.note);
    process.exit(1);
  }
  const inputs = ctgovToKolInputs(competition).slice(0, n);
  console.log(`[enrich-kols] researching ${inputs.length} of ${competition.investigators.length} investigators…`);

  const enrichments = await enrichInvestigators(
    inputs.map((k) => ({ name: k.name, affiliation: k.affiliation, therapeuticArea: condition })),
    { concurrency: 4, processor: "base" },
  );

  let ok = 0;
  for (const [name, e] of enrichments) {
    if (e.source === "parallel") {
      ok++;
      console.log(`  ✓ ${name}: pubs=${e.pubsCountTa} society=${JSON.stringify(e.societyRoles)} guideline=${e.guidelineAuthor} conf=${e.confidence} cites=${e.citations.length}`);
    } else {
      console.log(`  · ${name}: unavailable`);
    }
  }
  mergeIntoStore(enrichments);
  console.log(`[enrich-kols] wrote ${ok}/${inputs.length} enrichments to data/kol-enrichment.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
