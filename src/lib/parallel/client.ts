/**
 * Parallel.ai Task API client — deep web research with structured, CITED output.
 * https://docs.parallel.ai/task-api
 *
 * The Task API takes an `input` + a JSON-Schema `output_schema` and returns
 * `output.content` (fields) plus `output.basis[]` (per-field citations + reasoning +
 * confidence) — which maps directly onto TrialBridge's `Metric` provenance rule:
 * researched facts arrive with sources and a confidence level, so they can be sealed
 * honestly (never dressed up as peer-reviewed).
 *
 * Same discipline as the other connectors: the key comes from the environment
 * (`PARALLEL_API_KEY`, never hard-coded), and the client GRACEFULLY DEGRADES —
 * missing key / timeout / non-200 all return `status: "unavailable"` so callers keep
 * their existing (unenriched) data rather than crashing or fabricating.
 *
 * Lifecycle: POST /v1/tasks/runs (create) → poll GET /v1/tasks/runs/{id} → GET
 * /v1/tasks/runs/{id}/result. Polling is iteration-bounded (no wall-clock reads) so
 * behaviour is deterministic given the poll budget.
 */

export type Processor = "lite" | "base" | "core" | "pro" | "ultra";
export type ParallelConfidence = "high" | "medium" | "low";

export interface BasisCitation {
  url?: string | null;
  title?: string | null;
  excerpts?: string[];
}
export interface BasisEntry {
  field: string;
  citations: BasisCitation[];
  reasoning?: string | null;
  confidence?: ParallelConfidence | null;
}

export interface TaskResult {
  status: "completed" | "failed" | "unavailable";
  content: Record<string, unknown> | null;
  basis: BasisEntry[];
  runId: string | null;
  error?: string | null;
}

export interface RunTaskOptions {
  outputSchema: object; // a JSON Schema (type object + properties)
  processor?: Processor;
  /** Total poll budget = pollMs × maxPolls. */
  pollMs?: number;
  maxPolls?: number;
  createTimeoutMs?: number;
  signal?: AbortSignal;
  /** Injectable fetch + sleep for testing (default global fetch + real timer). */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULTS = { processor: "core" as Processor, pollMs: 2500, maxPolls: 24, createTimeoutMs: 15000 };

/** Read the Parallel config from the environment. */
export function parallelConfig(): { apiKey: string | null; baseUrl: string } {
  return {
    apiKey: process.env.PARALLEL_API_KEY ?? null,
    baseUrl: (process.env.PARALLEL_BASE_URL ?? "https://api.parallel.ai").replace(/\/+$/, ""),
  };
}

/** Is the Parallel pipe usable (key present)? */
export function parallelEnabled(): boolean {
  return !!parallelConfig().apiKey;
}

/** Pure: build the create-run request body (spec: task_spec.output_schema.json_schema). */
export function buildRunRequest(input: string | object, jsonSchema: object, processor: Processor) {
  return {
    input,
    processor,
    task_spec: { output_schema: { type: "json", json_schema: jsonSchema } },
  };
}

/** Pure: normalize a completed run's result JSON into a `TaskResult`. */
export function parseTaskResult(json: unknown): TaskResult {
  const j = (json ?? {}) as {
    run?: { run_id?: string; status?: string };
    output?: { content?: Record<string, unknown>; basis?: unknown[] };
  };
  const status = j.run?.status === "completed" ? "completed" : j.run?.status === "failed" ? "failed" : "completed";
  const basis: BasisEntry[] = Array.isArray(j.output?.basis)
    ? (j.output!.basis as Record<string, unknown>[]).map((b) => ({
        field: String(b.field ?? ""),
        citations: Array.isArray(b.citations)
          ? (b.citations as Record<string, unknown>[]).map((c) => ({
              url: (c.url as string) ?? null,
              title: (c.title as string) ?? null,
              excerpts: Array.isArray(c.excerpts) ? (c.excerpts as string[]) : [],
            }))
          : [],
        reasoning: (b.reasoning as string) ?? null,
        confidence: normalizeConfidence(b.confidence),
      }))
    : [];
  return { status, content: j.output?.content ?? null, basis, runId: j.run?.run_id ?? null };
}

function normalizeConfidence(c: unknown): ParallelConfidence | null {
  const s = typeof c === "string" ? c.toLowerCase() : "";
  return s === "high" || s === "medium" || s === "low" ? (s as ParallelConfidence) : null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const unavailable = (error: string): TaskResult => ({ status: "unavailable", content: null, basis: [], runId: null, error });

/**
 * Run one Task-API research task end-to-end (create → poll → result). Never throws;
 * degrades to `status: "unavailable"` on missing key, timeout, or any HTTP error.
 */
export async function runTask(input: string | object, opts: RunTaskOptions): Promise<TaskResult> {
  const { apiKey, baseUrl } = parallelConfig();
  if (!apiKey) return unavailable("PARALLEL_API_KEY not set");

  const fetchImpl = opts.fetchImpl ?? fetch;
  const doSleep = opts.sleepImpl ?? sleep;
  const processor = opts.processor ?? DEFAULTS.processor;
  const pollMs = opts.pollMs ?? DEFAULTS.pollMs;
  const maxPolls = opts.maxPolls ?? DEFAULTS.maxPolls;
  const headers = { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" };

  try {
    const createRes = await fetchImpl(`${baseUrl}/v1/tasks/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildRunRequest(input, opts.outputSchema, processor)),
      signal: opts.signal ?? AbortSignal.timeout(opts.createTimeoutMs ?? DEFAULTS.createTimeoutMs),
    });
    if (!createRes.ok) return unavailable(`Parallel create returned ${createRes.status}`);
    const created = (await createRes.json()) as { run_id?: string; status?: string };
    const runId = created.run_id;
    if (!runId) return unavailable("Parallel create returned no run_id");

    // Poll status until terminal or budget exhausted.
    for (let i = 0; i < maxPolls; i++) {
      await doSleep(pollMs);
      const statusRes = await fetchImpl(`${baseUrl}/v1/tasks/runs/${runId}`, { headers, signal: opts.signal });
      if (!statusRes.ok) continue;
      const st = (await statusRes.json()) as { status?: string };
      if (st.status === "failed") return unavailable("Parallel run failed");
      if (st.status === "completed") break;
      if (i === maxPolls - 1) return unavailable("Parallel run did not complete within the poll budget");
    }

    const resultRes = await fetchImpl(`${baseUrl}/v1/tasks/runs/${runId}/result`, { headers, signal: opts.signal });
    if (!resultRes.ok) return unavailable(`Parallel result returned ${resultRes.status}`);
    return parseTaskResult(await resultRes.json());
  } catch (e) {
    return unavailable(`Parallel task unavailable (${e instanceof Error ? e.message : "error"})`);
  }
}
