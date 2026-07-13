import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchProtocol } from "@/lib/ctgov";
import { normalizeStudy } from "@/lib/ctgov/normalize";
import { HERO_META, HERO_PROTOCOL_TEXT } from "@/data/hero-protocol";
import {
  RELAY_REDEFINE_META,
  RELAY_REDEFINE_PROTOCOL_TEXT,
} from "@/data/relay-redefine-protocol";
import type { RawCtGovStudy } from "@/lib/ctgov/types";

const REALISTIC_PAYLOAD: RawCtGovStudy = {
  protocolSection: {
    identificationModule: {
      nctId: "NCT03529110",
      briefTitle: "DS-8201a Versus T-DM1 for HER2-Positive Breast Cancer",
      officialTitle: "A Phase 3 Study of DS-8201a Versus T-DM1 for HER2-Positive Breast Cancer",
    },
    statusModule: { overallStatus: "ACTIVE_NOT_RECRUITING" },
    sponsorCollaboratorsModule: { leadSponsor: { name: "Daiichi Sankyo" } },
    designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE3"] },
    conditionsModule: { conditions: ["Breast Cancer"] },
    eligibilityModule: {
      eligibilityCriteria: "Inclusion Criteria:\n\n1. Adults >=18 y old.\n\nExclusion Criteria:\n\n1. LVEF < 50%.",
      minimumAge: "18 Years",
      sex: "ALL",
      healthyVolunteers: false,
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeStudy", () => {
  it("reshapes a realistic CT.gov v2 payload into NormalizedProtocol", () => {
    const p = normalizeStudy(REALISTIC_PAYLOAD);
    expect(p.nctId).toBe("NCT03529110");
    expect(p.sponsor).toBe("Daiichi Sankyo");
    expect(p.phase).toEqual(["PHASE3"]);
    expect(p.conditions).toEqual(["Breast Cancer"]);
    expect(p.eligibilityCriteria).toMatch(/Inclusion Criteria/);
    expect(p.sourceUrl).toBe("https://clinicaltrials.gov/study/NCT03529110");
  });

  it("throws a descriptive error when nctId is missing", () => {
    expect(() => normalizeStudy({ protocolSection: {} })).toThrow(/nctId/);
  });
});

describe("fetchProtocol", () => {
  it("returns source: live on a successful fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => REALISTIC_PAYLOAD,
    }));

    const result = await fetchProtocol("NCT03529110");
    expect(result.source).toBe("live");
    expect(result.protocol.nctId).toBe("NCT03529110");
    expect(result.protocol.eligibilityCriteria).toMatch(/Inclusion Criteria/);
  });

  it("falls back to the cached hero fixture when the live fetch fails for a known NCT id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchProtocol(HERO_META.nct);
    expect(result.source).toBe("cached");
    expect(result.protocol.nctId).toBe(HERO_META.nct);
    expect(result.protocol.eligibilityCriteria).toBe(HERO_PROTOCOL_TEXT);
    expect(result.note).toMatch(/network down/);
  });

  it("keeps the NCT06982521 intake usable when ClinicalTrials.gov is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchProtocol(RELAY_REDEFINE_META.nct);
    expect(result.source).toBe("cached");
    expect(result.protocol.nctId).toBe(RELAY_REDEFINE_META.nct);
    expect(result.protocol.eligibilityCriteria).toBe(RELAY_REDEFINE_PROTOCOL_TEXT);
  });

  it("throws a clear error when an unknown NCT id fails to fetch (no fabricated cache)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchProtocol("NCT00000000")).rejects.toThrow(/Could not fetch NCT00000000/);
  });
});
