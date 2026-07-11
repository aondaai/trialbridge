/**
 * Parallel Search API — the FAST, synchronous web primitive.
 * https://docs.parallel.ai/search-api
 *
 * Where the Task API does multi-hop research over ~minutes and returns structured
 * JSON, the Search API is a single round-trip (seconds) that returns ranked, citation-
 * aware EXCERPTS shaped for LLM consumption. Use it for latency-sensitive grounding —
 * "is there recent news on X", "find this physician's institutional page" — anything
 * that must resolve inside a request instead of a background job.
 *
 * Same discipline as the Task client: key from the environment, never throws — a
 * missing key / timeout / HTTP error returns an empty, `available:false` result so the
 * caller can proceed unenriched.
 */

import { parallelConfig, parallelEnabled } from "@/lib/parallel/client";

export type SearchProcessor = "base" | "pro";

export interface SearchResultItem {
  url: string;
  title: string | null;
  publishDate: string | null;
  excerpts: string[];
}

export interface SearchResponse {
  available: boolean;
  results: SearchResultItem[];
  searchId: string | null;
  error?: string | null;
}

export interface SearchOptions {
  searchQueries?: string[];
  processor?: SearchProcessor;
  maxResults?: number;
  maxCharsPerResult?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20000;

/** Pure: build the /v1/search request body. */
export function buildSearchRequest(objective: string, opts: SearchOptions = {}) {
  const body: Record<string, unknown> = {
    objective,
    search_queries: opts.searchQueries ?? [objective],
    processor: opts.processor ?? "pro", // max-power search tier by default
  };
  if (opts.maxResults != null) body.max_results = opts.maxResults;
  if (opts.maxCharsPerResult != null) body.max_chars_per_result = opts.maxCharsPerResult;
  return body;
}

/** Pure: normalize the /v1/search response. */
export function parseSearchResponse(json: unknown): SearchResponse {
  const j = (json ?? {}) as { search_id?: string; results?: Record<string, unknown>[] };
  const results: SearchResultItem[] = Array.isArray(j.results)
    ? j.results.map((r) => ({
        url: String(r.url ?? ""),
        title: (r.title as string) ?? null,
        publishDate: (r.publish_date as string) ?? null,
        excerpts: Array.isArray(r.excerpts) ? (r.excerpts as string[]) : [],
      }))
    : [];
  return { available: true, results, searchId: j.search_id ?? null };
}

const unavailable = (error: string): SearchResponse => ({ available: false, results: [], searchId: null, error });

/**
 * One synchronous web search. Never throws; degrades to `available:false` on missing
 * key / timeout / HTTP error.
 */
export async function search(objective: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const { apiKey, baseUrl } = parallelConfig();
  if (!apiKey) return unavailable("PARALLEL_API_KEY not set");
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(`${baseUrl}/v1/search`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildSearchRequest(objective, opts)),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) return unavailable(`Parallel search returned ${res.status}`);
    return parseSearchResponse(await res.json());
  } catch (e) {
    return unavailable(`Parallel search unavailable (${e instanceof Error ? e.message : "error"})`);
  }
}

export { parallelEnabled };
