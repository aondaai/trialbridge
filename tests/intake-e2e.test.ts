import { describe, it, expect, vi, afterEach } from "vitest";
import { defaultRegistry } from "@/lib/intake";
import type { IntakeInput } from "@/lib/intake";
import { HERO_META } from "@/data/hero-protocol";
import { FHIR_EVIDENCE_VARIABLE, EUCTR_FIXTURE } from "@/data/intakeFixtures";

/**
 * End-to-end mirror of scripts/demo-intake.ts: every registered adapter ingests
 * its cached fixture offline (no network, no API key) and lands on exactly one
 * lane. This is the regression guard behind the demo's proof.
 */
afterEach(() => vi.unstubAllGlobals());

const CASES: { input: IntakeInput; adapter: string; lane: "text" | "structured" }[] = [
  { input: { kind: "id", id: HERO_META.nct }, adapter: "ctgov", lane: "text" },
  { input: { kind: "text", text: "Inclusion Criteria:\n- Age >= 18.\nExclusion Criteria:\n- Brain mets." }, adapter: "document", lane: "text" },
  { input: { kind: "json", data: FHIR_EVIDENCE_VARIABLE }, adapter: "fhir", lane: "structured" },
  { input: { kind: "id", id: EUCTR_FIXTURE.eudractNumber }, adapter: "euctr", lane: "text" },
];

describe("intake end-to-end over all adapters (offline)", () => {
  it("routes each fixture to the right adapter and populates exactly one lane", async () => {
    // Force registry fetches to fail so ctgov/euctr use their cached fixtures.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    for (const c of CASES) {
      const detected = defaultRegistry().detectBest(c.input);
      expect(detected?.adapter.id).toBe(c.adapter);

      const result = await defaultRegistry().ingest(c.input);
      const hasText = typeof result.eligibilityText === "string" && result.eligibilityText.length > 0;
      const hasStructured = Array.isArray(result.preParsedCriteria) && result.preParsedCriteria.length > 0;

      // Exactly one lane populated.
      expect(hasText !== hasStructured).toBe(true);
      expect(c.lane === "text" ? hasText : hasStructured).toBe(true);
      expect(["high", "medium", "low"]).toContain(result.provenance.trust);
      expect(result.metadata.sourceId.length).toBeGreaterThan(0);
    }
  });
});
