import { describe, it, expect, afterEach } from "vitest";
import {
  buildSearchRequest,
  parseSearchResponse,
  search,
} from "@/lib/parallel/search";

const KEY = "PARALLEL_API_KEY";
afterEach(() => delete process.env[KEY]);

describe("Search API — request/response (pure)", () => {
  it("buildSearchRequest defaults search_queries to the objective and adds optional params", () => {
    expect(buildSearchRequest("KOL breast cancer Brazil")).toEqual({
      objective: "KOL breast cancer Brazil",
      search_queries: ["KOL breast cancer Brazil"],
    });
    expect(buildSearchRequest("x", { searchQueries: ["a", "b"], processor: "pro", maxResults: 5, maxCharsPerResult: 800 })).toEqual({
      objective: "x",
      search_queries: ["a", "b"],
      processor: "pro",
      max_results: 5,
      max_chars_per_result: 800,
    });
  });

  it("parseSearchResponse normalizes results (url/title/publishDate/excerpts)", () => {
    const r = parseSearchResponse({
      search_id: "s1",
      results: [
        { url: "https://pubmed.gov/1", title: "Paper", publish_date: "2024-01-01", excerpts: ["abc"] },
        { url: "https://x.org" },
      ],
    });
    expect(r.available).toBe(true);
    expect(r.searchId).toBe("s1");
    expect(r.results[0]).toEqual({ url: "https://pubmed.gov/1", title: "Paper", publishDate: "2024-01-01", excerpts: ["abc"] });
    expect(r.results[1]).toEqual({ url: "https://x.org", title: null, publishDate: null, excerpts: [] });
  });
});

describe("Search API — graceful degradation", () => {
  it("returns available:false with no key (no network)", async () => {
    const r = await search("anything");
    expect(r.available).toBe(false);
    expect(r.error).toMatch(/PARALLEL_API_KEY/);
    expect(r.results).toHaveLength(0);
  });

  it("degrades on a non-200 with an injected fetch", async () => {
    process.env[KEY] = "test";
    const fetchImpl = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    const r = await search("q", { fetchImpl });
    expect(r.available).toBe(false);
    expect(r.error).toMatch(/429/);
  });

  it("parses a successful search with an injected fetch", async () => {
    process.env[KEY] = "test";
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ search_id: "s", results: [{ url: "https://a", excerpts: ["e"] }] }),
    })) as unknown as typeof fetch;
    const r = await search("q", { fetchImpl });
    expect(r.available).toBe(true);
    expect(r.results[0].url).toBe("https://a");
  });
});
