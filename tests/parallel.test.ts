import { describe, it, expect, afterEach } from "vitest";
import {
  buildRunRequest,
  parseTaskResult,
  parallelEnabled,
  runTask,
} from "@/lib/parallel/client";
import { pooledMap, deepSearchMany } from "@/lib/parallel/deepSearch";
import {
  enrichInput,
  parseEnrichment,
  applyEnrichment,
  enrichInvestigators,
  KOL_OUTPUT_SCHEMA,
  InvestigatorEnrichment,
} from "@/lib/kol/enrich";
import { Confidence } from "@/lib/metric";
import type { KolInvestigatorInput } from "@/lib/kol/score";

const KEY = "PARALLEL_API_KEY";
afterEach(() => {
  delete process.env[KEY];
});

describe("Parallel client — pure request/response", () => {
  it("buildRunRequest nests the output schema under task_spec.output_schema.json_schema", () => {
    const body = buildRunRequest("United Nations", { type: "object" }, "core");
    expect(body).toEqual({
      input: "United Nations",
      processor: "core",
      task_spec: { output_schema: { type: "json", json_schema: { type: "object" } } },
    });
  });

  it("parseTaskResult extracts content + basis (citations, reasoning, confidence)", () => {
    const r = parseTaskResult({
      run: { run_id: "trun_1", status: "completed" },
      output: {
        type: "json",
        content: { pubs_count_ta: 12, society_roles: ["SBOC"], guideline_author: true },
        basis: [
          { field: "pubs_count_ta", citations: [{ url: "https://pubmed.gov/x", excerpts: ["12 papers"] }], reasoning: "found", confidence: "High" },
        ],
      },
    });
    expect(r.status).toBe("completed");
    expect(r.content).toEqual({ pubs_count_ta: 12, society_roles: ["SBOC"], guideline_author: true });
    expect(r.basis[0].field).toBe("pubs_count_ta");
    expect(r.basis[0].citations[0].url).toBe("https://pubmed.gov/x");
    expect(r.basis[0].confidence).toBe("high"); // normalized
    expect(r.runId).toBe("trun_1");
  });
});

describe("runTask — lifecycle + graceful degradation", () => {
  it("returns 'unavailable' when no API key is set (no network attempted)", async () => {
    expect(parallelEnabled()).toBe(false);
    const r = await runTask("x", { outputSchema: { type: "object" } });
    expect(r.status).toBe("unavailable");
    expect(r.error).toMatch(/PARALLEL_API_KEY/);
  });

  it("drives create → poll → result with an injected fetch", async () => {
    process.env[KEY] = "test-key";
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/v1/tasks/runs")) return jsonRes({ run_id: "trun_9", status: "queued" });
      if (url.endsWith("/trun_9")) return jsonRes({ status: "completed" });
      if (url.endsWith("/trun_9/result"))
        return jsonRes({ run: { run_id: "trun_9", status: "completed" }, output: { content: { ok: 1 }, basis: [] } });
      return jsonRes({}, 404);
    }) as unknown as typeof fetch;

    const r = await runTask("q", { outputSchema: { type: "object" }, fetchImpl, sleepImpl: async () => {}, pollMs: 0 });
    expect(r.status).toBe("completed");
    expect(r.content).toEqual({ ok: 1 });
    expect(calls.some((u) => u.endsWith("/v1/tasks/runs"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/trun_9/result"))).toBe(true);
  });

  it("degrades to 'unavailable' on a create error", async () => {
    process.env[KEY] = "test-key";
    const fetchImpl = (async () => jsonRes({}, 500)) as unknown as typeof fetch;
    const r = await runTask("q", { outputSchema: {}, fetchImpl, sleepImpl: async () => {} });
    expect(r.status).toBe("unavailable");
    expect(r.error).toMatch(/500/);
  });
});

describe("pooledMap — the parallel pipe", () => {
  it("preserves order and bounds concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const worker = async (n: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n * 2;
    };
    const out = await pooledMap([1, 2, 3, 4, 5, 6, 7], worker, 3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]); // order preserved
    expect(maxActive).toBeLessThanOrEqual(3); // concurrency bounded
  });

  it("deepSearchMany with no key returns all 'unavailable', never rejects", async () => {
    const out = await deepSearchMany(["a", "b"], { type: "object" });
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.status === "unavailable")).toBe(true);
  });
});

describe("KOL enrichment", () => {
  it("KOL_OUTPUT_SCHEMA asks for pubs, society roles, and guideline authorship", () => {
    expect(Object.keys(KOL_OUTPUT_SCHEMA.properties)).toEqual(["pubs_count_ta", "society_roles", "guideline_author"]);
  });

  it("enrichInput builds a research prompt with the affiliation + TA", () => {
    const s = enrichInput({ name: "Marcos Mattos", affiliation: "Barretos", therapeuticArea: "breast cancer" });
    expect(s).toMatch(/Marcos Mattos/);
    expect(s).toMatch(/Barretos/);
    expect(s).toMatch(/breast cancer/);
  });

  it("parseEnrichment maps a completed result → signals + citations + rolled-up confidence", () => {
    const e = parseEnrichment("Dr. A", {
      status: "completed",
      runId: "r",
      content: { pubs_count_ta: 30, society_roles: ["SBOC", ""], guideline_author: true },
      basis: [
        { field: "pubs_count_ta", citations: [{ url: "https://pubmed.gov/1", excerpts: [] }, { url: "https://pubmed.gov/1" }], confidence: "high" },
        { field: "society_roles", citations: [{ url: "https://sboc.org.br", title: "SBOC" }], confidence: "medium" },
      ],
    });
    expect(e.source).toBe("parallel");
    expect(e.pubsCountTa).toBe(30);
    expect(e.societyRoles).toEqual(["SBOC"]); // empty string filtered
    expect(e.guidelineAuthor).toBe(true);
    expect(e.confidence).toBe(Confidence.MEDIUM); // weakest of high+medium
    expect(e.citations.map((c) => c.url)).toEqual(["https://pubmed.gov/1", "https://sboc.org.br"]); // deduped
  });

  it("parseEnrichment on an unavailable result → zeros + LOW", () => {
    const e = parseEnrichment("Dr. B", { status: "unavailable", runId: null, content: null, basis: [] });
    expect(e.source).toBe("unavailable");
    expect(e.pubsCountTa).toBe(0);
    expect(e.confidence).toBe(Confidence.LOW);
  });

  it("applyEnrichment merges pubs/society but keeps trial experience; leaves others untouched", () => {
    const inputs: KolInvestigatorInput[] = [
      { name: "Dr. A", regionCode: "SE", signals: { trialsCount: 5, pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, hasCnesLink: false } },
      { name: "Dr. B", regionCode: "SE", signals: { trialsCount: 2, pubsCountTa: 0, societyRoles: [], guidelineAuthor: false, hasCnesLink: false } },
    ];
    const enr = new Map<string, InvestigatorEnrichment>([
      ["Dr. A", { name: "Dr. A", source: "parallel", pubsCountTa: 30, societyRoles: ["SBOC"], guidelineAuthor: true, confidence: Confidence.HIGH, citations: [] }],
    ]);
    const out = applyEnrichment(inputs, enr);
    expect(out[0].signals).toMatchObject({ trialsCount: 5, pubsCountTa: 30, societyRoles: ["SBOC"], guidelineAuthor: true });
    expect(out[1].signals.pubsCountTa).toBe(0); // Dr. B unchanged
  });

  it("enrichInvestigators is a no-op (empty map) when the key is absent", async () => {
    const m = await enrichInvestigators([{ name: "Dr. A" }]);
    expect(m.size).toBe(0);
  });
});

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
