/**
 * Live Feasibility Autofill runner (ADR-002 live seam, integration "A").
 *
 * Runs the full A/B/C/D orchestration end-to-end against REAL backends: Prisma for A/B/D data,
 * the site-side cohort.preview MCP tool for C (aggregates only), and Claude for D drafts + the
 * critic (when ANTHROPIC_API_KEY is set; grounded template/heuristic otherwise).
 *
 *   npm run autofill:run -- --site site-ihealth-demo [--docx path/to/form.docx]
 *
 * GATING: the deterministic path (A/B/C + template D) runs WITHOUT a key. The Claude-backed D
 * drafter/critic only fire when ANTHROPIC_API_KEY is present — this script refuses to pretend a
 * key exists, and prints which mode it used. It makes outbound Anthropic calls ONLY in keyed
 * mode, so you control the spend.
 */

import { readFileSync } from "node:fs";
import { parseFormText, ingestForm, type FormFieldDraft } from "@/lib/feasibility-autofill/ingest";
import { CANONICAL_SECTIONS } from "@/lib/feasibility-autofill/canonicalTemplate";
import { orchestrateAutofill } from "@/lib/feasibility-autofill/mcp/orchestrator";
import { buildLiveDeps } from "@/lib/feasibility-autofill/mcp/liveDeps";
import type { Criterion } from "@/lib/matcher/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A synthetic form covering every canonical section (used when no --docx is given). */
function syntheticFields(): FormFieldDraft[] {
  const text = CANONICAL_SECTIONS.map((s) => `${s.idx}. ${s.name}\n${s.content.split(",")[0]}?`).join("\n\n");
  return parseFormText(text).fields;
}

/** A small default criteria set so the C cohort has something to evaluate. */
const DEFAULT_CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
  { id: "c2", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast", rawText: "Câncer de mama", confidence: 1 },
];

async function main() {
  const siteId = arg("site") ?? "site-ihealth-demo";
  const docxPath = arg("docx");
  const keyed = Boolean(process.env.ANTHROPIC_API_KEY);

  const fields = docxPath
    ? ingestForm({ kind: "file", filename: docxPath, bytes: new Uint8Array(readFileSync(docxPath)) }).fields
    : syntheticFields();

  console.log(`[autofill] site=${siteId} fields=${fields.length} mode=${keyed ? "Claude (keyed)" : "template/heuristic (no key)"}`);

  // asOf injected (kept clock-free inside resolvers); stamped here at the boundary.
  const asOf = new Date().toISOString();
  const { deps, close } = await buildLiveDeps({ asOf });
  try {
    const result = await orchestrateAutofill({ siteId, fields, criteria: DEFAULT_CRITERIA }, deps);

    console.log(`\n[autofill] ${result.answers.length} answers · provenance:`, result.provenance.bySeal);
    console.log(`[autofill] cohort:`, result.cohort ? `${result.cohort.n} candidates (suppressed=${result.cohort.suppressed})` : "n/a");
    for (const a of result.answers.slice(0, 12)) {
      const val = a.metric.value ?? "—";
      const flag = a.archetype === "D" ? ` [critique: ${a.critique?.grounded ? "grounded" : (a.critique?.issues.join("; ") ?? "?")}]` : "";
      console.log(`  ${a.archetype} · ${a.status.padEnd(8)} · ${a.label.slice(0, 44).padEnd(44)} → ${String(val).slice(0, 40)}${flag}`);
    }
    if (result.answers.length > 12) console.log(`  … +${result.answers.length - 12} more`);
    console.log(`\n[autofill] done. Every value is a provenanced Metric; D answers are proposed (human review required).`);
  } finally {
    close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[autofill] failed:", (e as Error).message);
    process.exit(1);
  });
