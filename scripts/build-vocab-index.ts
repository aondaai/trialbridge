/**
 * Builds data/vocab-index.json from a locally-downloaded Athena OMOP
 * vocabulary bundle (data/vocab/CONCEPT.csv). Run this after you've
 * downloaded the bundle from athena.ohdsi.org under your own account
 * (license required — this repo cannot fetch it for you, see
 * docs/omop-vocabulary-mapping.md).
 *
 * The matching logic lives in src/lib/omop/buildVocabIndex.ts (directly
 * unit-tested); this script is a thin CLI wrapper: read CONCEPT.csv, match
 * against every conceptName in FIELD_CONCEPT_MAP, write the small resulting
 * index, print an honest summary of what did and didn't match.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FIELD_CONCEPT_MAP } from "../src/lib/omop/vocabulary";
import { parseConceptTsv, buildVocabIndexFromConcepts } from "../src/lib/omop/buildVocabIndex";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONCEPT_CSV = resolve(__dirname, "..", "data", "vocab", "CONCEPT.csv");
const OUT_PATH = resolve(__dirname, "..", "data", "vocab-index.json");

function main() {
  if (!existsSync(CONCEPT_CSV)) {
    console.error(
      `Not found: ${CONCEPT_CSV}\n\n` +
        "Download the Athena vocabulary bundle from https://athena.ohdsi.org " +
        "(requires your own account + license acceptance), unzip it, and place " +
        "CONCEPT.csv at data/vocab/CONCEPT.csv. See docs/omop-vocabulary-mapping.md.",
    );
    process.exit(1);
  }

  const content = readFileSync(CONCEPT_CSV, "utf8");
  const concepts = parseConceptTsv(content);
  const conceptNames = Object.values(FIELD_CONCEPT_MAP).map((f) => f.conceptName);

  const { index, unmatched } = buildVocabIndexFromConcepts(concepts, conceptNames);

  writeFileSync(OUT_PATH, JSON.stringify(index, null, 2) + "\n");

  const matchedCount = Object.keys(index).length;
  console.log(`Parsed ${concepts.length} concept rows from CONCEPT.csv.`);
  console.log(`Matched ${matchedCount}/${conceptNames.length} fields -> ${OUT_PATH}`);
  if (unmatched.length > 0) {
    console.log(`Unmatched (still needsMapping: true until fixed by hand):`);
    for (const name of unmatched) console.log(`  - ${name}`);
  }
  console.log(
    "\nEvery match is a heuristic (exact/substring name match), not a guarantee — " +
      "spot-check before treating any of these as 'verified' in a pitch.",
  );
}

main();
