/**
 * Builds concept-map.json (at the repo root) from the verified hero + NSCLC
 * protocol fixtures, then prints the per-criterion resolution table.
 *
 * This is the OFFLINE build step. The heavy lifting lives in pure, unit-tested
 * modules (src/lib/omop/conceptMap.ts + cid10.ts); this script is a thin CLI
 * wrapper — same split as scripts/build-vocab-index.ts. In F006 it gains a
 * Claude anchor fallback for diagnoses the lexical layer can't resolve; today
 * it is lexical-only and fully deterministic.
 *
 * Run: npm run build-concept-map
 */

import { buildConceptMap, writeConceptMap, conceptMapPath, type ConceptMapEntry } from "../src/lib/omop/conceptMap";
import { HERO_META, HERO_CRITERIA } from "../src/data/hero-protocol";
import { NSCLC_META, NSCLC_CRITERIA } from "../src/data/nsclc-kras-protocol";

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

function cidCell(e: ConceptMapEntry): string {
  return e.icd10 ? e.icd10.prefixes.join("+") : "-";
}

function printTable(entries: ConceptMapEntry[]): void {
  const cols = [
    ["criterion", 12],
    ["label", 34],
    ["answerability", 13],
    ["CID-10", 10],
    ["domain", 13],
    ["anchoredBy", 10],
    ["review", 6],
  ] as const;
  const header = cols.map(([h, w]) => pad(h, w)).join("  ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const e of entries) {
    const row = [
      pad(e.criterionId, 12),
      pad(e.textOriginal, 34),
      pad(e.answerability, 13),
      pad(cidCell(e), 10),
      pad(e.domain, 13),
      pad(e.anchoredBy, 10),
      pad(e.needsReview ? "⚠" : "", 6),
    ].join("  ");
    console.log(row);
  }
}

function main(): void {
  const protocols = [
    { nct: HERO_META.nct, criteria: HERO_CRITERIA },
    { nct: NSCLC_META.nct, criteria: NSCLC_CRITERIA },
  ];
  const map = buildConceptMap(protocols);
  writeConceptMap(map);

  printTable(map.entries);
  console.log("");
  console.log(`entries:        ${map.entries.length}`);
  console.log(`dxPrefixes:     ${JSON.stringify(map.dxPrefixes)}`);
  const review = map.entries.filter((e) => e.needsReview);
  console.log(`needsReview:    ${review.length}${review.length ? " -> " + review.map((e) => e.criterionId).join(", ") : ""}`);
  console.log(`generatedFrom:  ${map.generatedFrom.join(", ")}`);
  console.log(`wrote:          ${conceptMapPath()}`);
}

main();
