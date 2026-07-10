import { describe, it, expect, vi, afterEach } from "vitest";
import { defaultRegistry } from "@/lib/intake";
import { euctrAdapter } from "@/lib/intake/adapters/euctr";
import { EUCTR_FIXTURE } from "@/data/intakeFixtures";

afterEach(() => vi.unstubAllGlobals());

describe("euctr adapter — registry breadth (ctgov discipline)", () => {
  it("detects EudraCT numbers and EU CTR URLs, and does not claim NCT ids", () => {
    expect(euctrAdapter.detect({ kind: "id", id: "2019-000123-45" })).toBe(1);
    expect(
      euctrAdapter.detect({ kind: "url", url: "https://www.clinicaltrialsregister.eu/ctr-search/trial/2019-000123-45/results" }),
    ).toBe(1);
    expect(euctrAdapter.detect({ kind: "id", id: "NCT03529110" })).toBe(0);
    expect(euctrAdapter.detect({ kind: "text", text: "2019-000123-45" })).toBe(0);
  });

  it("routes a EudraCT id to euctr (not ctgov) through the registry", () => {
    const best = defaultRegistry().detectBest({ kind: "id", id: EUCTR_FIXTURE.eudractNumber });
    expect(best?.adapter.id).toBe("euctr");
  });

  it("falls back to the cached verified fixture when the live fetch fails for a known id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await defaultRegistry().ingest({ kind: "id", id: EUCTR_FIXTURE.eudractNumber });
    expect(result.metadata.sourceRegistry).toBe("eudract");
    expect(result.eligibilityText).toBe(EUCTR_FIXTURE.eligibilityText);
    expect(result.preParsedCriteria).toBeUndefined();
    expect(result.provenance.note).toMatch(/offline/);
  });

  it("throws for an unknown EudraCT id that can't be fetched (no fabricated cache)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(defaultRegistry().ingest({ kind: "id", id: "2020-999999-99" })).rejects.toThrow(
      /Could not fetch EudraCT 2020-999999-99/,
    );
  });
});
