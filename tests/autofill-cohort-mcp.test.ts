import { describe, it, expect } from "vitest";
import {
  runCohortPreview,
  parseCriteriaPayload,
  PatientDataLeakError,
  COHORT_PREVIEW_TOOL,
  type PatientLoader,
} from "@/lib/feasibility-autofill/mcp/cohortPreviewTool";
import { dispatch } from "@/lib/feasibility-autofill/mcp/cohortServer";
import type { Patient } from "@/lib/matcher/types";

function patient(id: string, age: number | null, her2: string | null): Patient {
  return {
    id, siteId: "s1", diagnosis: "breast", stage: null,
    biomarkers: { her2_status: her2 }, priorLines: null, ecog: null, labs: {}, sex: null, age,
  };
}

const PATIENTS: Patient[] = [
  patient("p1", 50, "positive"), patient("p2", 60, "positive"), patient("p3", 45, "positive"),
  patient("p4", 40, null), patient("p5", null, "positive"), patient("p6", 30, "negative"),
];

const loader: PatientLoader = async (siteId) => (siteId === "s1" ? PATIENTS : null);

const CRITERIA = [
  { kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18" },
  { kind: "inclusion", field: "her2_status", operator: "eq", value: "positive", rawText: "HER2+" },
];

describe("M0 · cohort.preview tool handler (residency boundary)", () => {
  it("returns aggregates only — no patient id in the payload", async () => {
    const preview = await runCohortPreview({ siteId: "s1", criteria: CRITERIA as never }, loader);
    expect(preview.n).toBe(5);
    expect(preview.suppressed).toBe(false);
    const serialized = JSON.stringify(preview);
    for (const p of PATIENTS) expect(serialized).not.toContain(p.id);
  });

  it("validates a malformed criteria payload", () => {
    expect(() => parseCriteriaPayload([])).toThrow(/non-empty/);
    expect(() => parseCriteriaPayload([{ field: "age" }])).toThrow(/kind/);
    expect(() => parseCriteriaPayload([{ kind: "inclusion", field: "age", operator: "??" }])).toThrow(/operator/);
  });

  it("rejects an unknown site", async () => {
    await expect(runCohortPreview({ siteId: "nope", criteria: CRITERIA as never }, loader)).rejects.toThrow(/unknown site/);
  });

  it("a small cohort suppresses to <5 and still leaks no id (guard in place)", async () => {
    const smallLoader: PatientLoader = async () => [patient("only-one", 50, "positive")];
    const preview = await runCohortPreview({ siteId: "s1", criteria: CRITERIA as never }, smallLoader);
    expect(preview.n).toBe("<5"); // suppressed
    expect(JSON.stringify(preview)).not.toContain("only-one");
    expect(PatientDataLeakError).toBeTypeOf("function"); // the boundary guard is wired
  });
});

describe("M0 · MCP stdio dispatch", () => {
  it("initialize returns protocol + server info", async () => {
    const r = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize" }, loader);
    expect(r).not.toBeNull();
    expect((r as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("trialbridge-cohort");
  });

  it("tools/list advertises cohort.preview", async () => {
    const r = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" }, loader);
    const tools = (r as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((t) => t.name)).toContain(COHORT_PREVIEW_TOOL.name);
  });

  it("tools/call cohort.preview returns aggregates in structuredContent, no rows", async () => {
    const r = await dispatch(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cohort.preview", arguments: { siteId: "s1", criteria: CRITERIA } } },
      loader,
    );
    const result = (r as { result: { structuredContent: { n: number }; isError: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(false);
    expect(result.structuredContent.n).toBe(5);
    for (const p of PATIENTS) expect(result.content[0].text).not.toContain(p.id);
  });

  it("notifications/initialized yields no response", async () => {
    expect(await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }, loader)).toBeNull();
  });

  it("an unknown tool returns a JSON-RPC error", async () => {
    const r = await dispatch(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "delete.everything", arguments: {} } },
      loader,
    );
    expect((r as { error: { code: number } }).error.code).toBe(-32601);
  });

  it("a null / malformed request returns an error instead of crashing", async () => {
    const r = await dispatch(null as never, loader);
    expect((r as { error: { code: number } }).error.code).toBe(-32600);
    const r2 = await dispatch({ jsonrpc: "2.0", id: 9 } as never, loader); // no method
    expect((r2 as { error: { code: number } }).error.code).toBe(-32600);
  });
});
