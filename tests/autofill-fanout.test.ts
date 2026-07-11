import { describe, it, expect, vi } from "vitest";
import { fanOutAutofill, type StudyRequest } from "@/lib/feasibility-autofill/mcp/fanout";
import type { OrchestratorDeps } from "@/lib/feasibility-autofill/mcp/orchestrator";
import type { FormFieldDraft } from "@/lib/feasibility-autofill/ingest";

const FIELDS: FormFieldDraft[] = [
  { section: "Contagens", label: "Nº de pacientes elegíveis", cellType: "number", archetypeHint: "C", orderIdx: 0 },
];
const STUDY: StudyRequest = { fields: FIELDS, criteria: [{ id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "≥18", confidence: 1 }] };

/** Per-site deps whose cohort count is keyed by site (site-c is suppressed, site-x throws). */
function depsFor(siteId: string): OrchestratorDeps {
  const counts: Record<string, number | "<5"> = { "site-a": 40, "site-b": 12, "site-c": "<5" };
  return {
    loadProfile: async () => null,
    loadCapability: async () => null,
    cohortPreview: async (id) => {
      if (id === "site-x") throw new Error("site MCP tool offline");
      const n = counts[id] ?? 0;
      return { n, suppressed: n === "<5", perCriterionDelta: [] };
    },
    loadPriors: async () => [],
  };
}

describe("M3 · network fan-out across sites", () => {
  it("runs every site and aggregates precise counts, excluding suppressed", async () => {
    const r = await fanOutAutofill(STUDY, ["site-a", "site-b", "site-c"], depsFor);
    expect(r.summary.sites).toBe(3);
    expect(r.summary.succeeded).toBe(3);
    expect(r.summary.countedSites).toBe(2); // a, b
    expect(r.summary.totalCandidates).toBe(52); // 40 + 12; site-c (<5) excluded
    expect(r.summary.suppressedSites).toBe(1);
  });

  it("isolates a failing site — the sweep still completes", async () => {
    const r = await fanOutAutofill(STUDY, ["site-a", "site-x", "site-b"], depsFor);
    expect(r.summary.succeeded).toBe(2);
    expect(r.summary.failed).toBe(1);
    const failed = r.perSite.find((o) => o.siteId === "site-x")!;
    expect(failed.result).toBeNull();
    expect(failed.error).toMatch(/offline/);
    // the healthy sites still counted
    expect(r.summary.totalCandidates).toBe(52);
  });

  it("respects the concurrency cap and still processes all sites", async () => {
    let active = 0;
    let maxActive = 0;
    const slowDeps = (siteId: string): OrchestratorDeps => ({
      ...depsFor(siteId),
      cohortPreview: async () => {
        active++; maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        return { n: 10, suppressed: false, perCriterionDelta: [] };
      },
    });
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const r = await fanOutAutofill(STUDY, ids, slowDeps, 3);
    expect(r.summary.succeeded).toBe(10);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("no patient data appears in the network result (aggregates only)", async () => {
    const r = await fanOutAutofill(STUDY, ["site-a", "site-b"], depsFor);
    expect(JSON.stringify(r)).not.toMatch(/biomarkers|her2_status|"labs"/i);
  });
});
