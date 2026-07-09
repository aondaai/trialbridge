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

import Anthropic from "@anthropic-ai/sdk";
import {
  buildConceptMap,
  writeConceptMap,
  conceptMapPath,
  type ConceptMapEntry,
  type AnchorFallback,
  type ProtocolInput,
} from "../src/lib/omop/conceptMap";
import { anchorLexical, loadCid10Reference, normalizeTerm } from "../src/lib/omop/cid10";
import { HERO_META, HERO_CRITERIA } from "../src/data/hero-protocol";
import { NSCLC_META, NSCLC_CRITERIA } from "../src/data/nsclc-kras-protocol";

/**
 * OFFLINE anchor fallback. Collects the diagnosis values the lexical layer
 * can't resolve, asks Claude (once, here — never at request time) to propose
 * 3-char CID-10 categories, and returns a SYNCHRONOUS lookup buildConceptMap
 * can call. Everything it proposes is marked anchoredBy="model" +
 * needsReview=true downstream. Inert without ANTHROPIC_API_KEY.
 */
async function buildModelFallback(protocols: ProtocolInput[]): Promise<AnchorFallback | undefined> {
  const ref = loadCid10Reference();
  const misses = new Set<string>();
  for (const p of protocols) {
    for (const c of p.criteria) {
      if (c.field !== "diagnosis") continue;
      const term = String(c.value ?? "");
      if (anchorLexical(term, ref).codes.length === 0) misses.add(term);
    }
  }
  if (misses.size === 0) return undefined;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`(${misses.size} diagnosis term(s) unresolved by the lexical layer; set ANTHROPIC_API_KEY to propose CID-10 via Claude — they will be flagged needsReview either way.)`);
    return undefined;
  }

  const client = new Anthropic();
  const resolved: Record<string, { codes: string[]; note?: string }> = {};
  for (const term of misses) {
    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 512,
      system:
        "You map a free-text cancer diagnosis to WHO ICD-10 (CID-10) 3-character category codes (e.g. C50, C34). Return ONLY strict JSON {\"codes\":[\"C..\"],\"note\":\"...\"}. Use the WHO ICD-10 (not ICD-10-CM). If unsure, return an empty codes array.",
      messages: [{ role: "user", content: term }],
    });
    const block = resp.content.find((b) => b.type === "text");
    try {
      const parsed = JSON.parse(block && block.type === "text" ? block.text : "{}") as { codes?: string[]; note?: string };
      resolved[normalizeTerm(term)] = { codes: parsed.codes ?? [], note: parsed.note ?? `proposed by ${resp.model}` };
    } catch {
      resolved[normalizeTerm(term)] = { codes: [], note: "model returned unparseable output" };
    }
  }
  return (term: string) => resolved[normalizeTerm(term)] ?? null;
}

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

async function main(): Promise<void> {
  const protocols: ProtocolInput[] = [
    { nct: HERO_META.nct, criteria: HERO_CRITERIA },
    { nct: NSCLC_META.nct, criteria: NSCLC_CRITERIA },
  ];
  const fallback = await buildModelFallback(protocols);
  const map = buildConceptMap(protocols, undefined, fallback);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
