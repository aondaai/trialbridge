/**
 * Precompute site-infrastructure enrichment (Part B) via the Parallel Task API and write
 * it to the store the scorecard reads. The ~1 min/site research must not block a render.
 *
 *   npm run enrich-sites -- 8            # top 8 oncology sites by PI count
 *   npm run enrich-sites -- 8 2090236    # or specific CNES codes
 *
 * Needs PARALLEL_API_KEY in .env.local. Idempotent: merges into data/site-infra.json.
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

import { loadDirectory } from "@/lib/sites/loadDirectory";
import { enrichSites } from "@/lib/sites/infraEnrich";
import { mergeInfraStore } from "@/lib/sites/infraStore";
import { parallelEnabled } from "@/lib/parallel/client";

async function main() {
  if (!parallelEnabled()) {
    console.error("PARALLEL_API_KEY not set in .env.local — nothing to do.");
    process.exit(1);
  }
  const n = Number(process.argv[2] ?? 8);
  const explicitCnes = process.argv.slice(3);

  const dir = loadDirectory();
  const oncology = dir.filter((s) => s.oncology && s.cnes);
  const chosen = explicitCnes.length
    ? oncology.filter((s) => explicitCnes.includes(s.cnes!))
    : [...oncology].sort((a, b) => (b.piCount ?? 0) - (a.piCount ?? 0)).slice(0, n);

  console.log(`[enrich-sites] researching infra for ${chosen.length} sites…`);
  const subjects = chosen.map((s) => ({ cnes: s.cnes!, name: s.name, city: s.city, uf: s.uf }));
  const enrichments = await enrichSites(subjects, { concurrency: 4, processor: "base" });

  let ok = 0;
  for (const s of chosen) {
    const e = enrichments.get(s.cnes!);
    if (e?.source === "parallel") {
      ok++;
      console.log(`  ✓ ${s.name} (CNES ${s.cnes}): cacon=${e.caconOrUnacon} pet=${e.petCt} linac=${e.linearAccelerator} mri=${e.mri} icu=${e.icuBeds} pharmacy=${e.gcpPharmacy} conf=${e.confidence} cites=${e.citations.length}`);
    } else {
      console.log(`  · ${s.name} (CNES ${s.cnes}): unavailable`);
    }
  }
  mergeInfraStore(enrichments);
  console.log(`[enrich-sites] wrote ${ok}/${chosen.length} to data/site-infra.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
