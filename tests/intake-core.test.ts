import { describe, it, expect, vi, afterEach } from "vitest";
import { IntakeRegistry, defaultRegistry } from "@/lib/intake";
import { ctgovAdapter } from "@/lib/intake/adapters/ctgov";
import { HERO_META, HERO_PROTOCOL_TEXT } from "@/data/hero-protocol";
import type { SourceAdapter } from "@/lib/intake/types";

afterEach(() => vi.unstubAllGlobals());

/** A trivial fake adapter so registry behavior is tested in isolation. */
function fake(id: string, score: number): SourceAdapter {
  return {
    id,
    detect: () => score,
    extract: async () => ({
      metadata: { sourceId: id, sourceRegistry: "test", title: id },
      eligibilityText: `from ${id}`,
      provenance: { adapter: id, extraction: "text", trust: "low" },
    }),
  };
}

describe("IntakeRegistry", () => {
  it("selects the highest-scoring adapter", async () => {
    const reg = new IntakeRegistry().register(fake("lo", 0.2)).register(fake("hi", 0.9));
    const best = reg.detectBest({ kind: "text", text: "x" });
    expect(best?.adapter.id).toBe("hi");
    const result = await reg.ingest({ kind: "text", text: "x" });
    expect(result.provenance.adapter).toBe("hi");
  });

  it("ignores adapters that score 0 and throws when nothing claims the input", async () => {
    const reg = new IntakeRegistry().register(fake("zero", 0));
    expect(reg.detectBest({ kind: "text", text: "x" })).toBeNull();
    await expect(reg.ingest({ kind: "text", text: "x" })).rejects.toThrow(/no adapter recognized/);
  });

  it("rejects duplicate adapter ids", () => {
    const reg = new IntakeRegistry().register(fake("dup", 1));
    expect(() => reg.register(fake("dup", 1))).toThrow(/already registered/);
  });

  it("clamps out-of-range detect scores (edge case)", () => {
    const reg = new IntakeRegistry().register(fake("nan", NaN)).register(fake("big", 5));
    const best = reg.detectBest({ kind: "text", text: "x" });
    expect(best?.adapter.id).toBe("big");
    expect(best?.score).toBe(1);
  });
});

describe("ctgov adapter", () => {
  it("detects NCT ids and CT.gov URLs, rejects other input", () => {
    expect(ctgovAdapter.detect({ kind: "id", id: "NCT03529110" })).toBe(1);
    expect(ctgovAdapter.detect({ kind: "url", url: "https://clinicaltrials.gov/study/NCT03529110" })).toBe(1);
    expect(ctgovAdapter.detect({ kind: "id", id: "2019-000123-45" })).toBe(0);
    expect(ctgovAdapter.detect({ kind: "text", text: "NCT03529110" })).toBe(0);
  });

  it("maps a fetched protocol onto the neutral IntakeResult envelope (cached fallback path)", async () => {
    // Force the live fetch to fail so we hit the committed hero fixture — no network.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await defaultRegistry().ingest({ kind: "id", id: HERO_META.nct });
    expect(result.metadata.sourceId).toBe(HERO_META.nct);
    expect(result.metadata.sourceRegistry).toBe("clinicaltrials.gov");
    expect(result.eligibilityText).toBe(HERO_PROTOCOL_TEXT);
    expect(result.preParsedCriteria).toBeUndefined();
    expect(result.provenance).toMatchObject({ adapter: "ctgov", extraction: "api", trust: "high" });
  });

  it("throws for an unknown NCT id that can't be fetched (no fabricated cache)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(defaultRegistry().ingest({ kind: "id", id: "NCT00000000" })).rejects.toThrow(
      /Could not fetch NCT00000000/,
    );
  });
});
