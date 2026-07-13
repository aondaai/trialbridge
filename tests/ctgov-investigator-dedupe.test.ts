import { describe, expect, it } from "vitest";
import { buildInvestigatorDedupeAudit, canonicalInvestigatorName, jaroWinkler } from "@/lib/ctgov/investigatorDedupe";
import type { CtgovInvestigatorProfile } from "@/lib/ctgov/investigatorRosterModel";

const profile = (profileId: string, name: string, affiliation: string, nctIds: string[]): CtgovInvestigatorProfile => ({
  profileId,
  name,
  normalizedName: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  affiliation,
  normalizedAffiliation: affiliation.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  roles: ["PRINCIPAL_INVESTIGATOR"],
  nctIds,
  trialCount: nctIds.length,
  overallStatuses: [],
  conditions: [],
  sourceUrls: nctIds.map((id) => `https://clinicaltrials.gov/study/${id}`),
});

describe("ClinicalTrials.gov investigator deduplication audit", () => {
  it("normalizes credentials and measures close names", () => {
    expect(canonicalInvestigatorName("Dra. Ana María Silva, MD, PhD")).toBe("ana maria silva");
    expect(canonicalInvestigatorName("Rubens Belfort Jr, MD")).toBe("rubens belfort junior");
    expect(jaroWinkler("ana maria silva", "ana m silva")).toBeGreaterThan(0.88);
  });

  it("auto-merges corroborated variants but only reviews unsupported equal names", () => {
    const audit = buildInvestigatorDedupeAudit([
      profile("a", "Ana Maria Silva, MD", "Hospital Albert Einstein", ["NCT1"]),
      profile("b", "Ana Maria Silva, PhD", "Albert Einstein Hospital", ["NCT2"]),
      profile("c", "Joao Souza", "Hospital A", ["NCT3"]),
      profile("d", "Joao Souza", "Hospital B", ["NCT4"]),
    ], "2026-07-13T00:00:00.000Z");
    expect(audit.summary.autoMergeClusters).toBe(1);
    expect(audit.autoMergeClusters[0].profileIds).toEqual(["a", "b"]);
    expect(audit.reviewPairs.some((pair) => pair.leftName === "Joao Souza")).toBe(true);
  });

  it("routes generic contacts to quality exclusion", () => {
    const audit = buildInvestigatorDedupeAudit([
      profile("a", "Trial Manager", "Sponsor Brazil", ["NCT1"]),
      profile("b", "Trial Manager", "Sponsor Argentina", ["NCT2"]),
    ]);
    expect(audit.summary.suspectedNonPersonProfiles).toBe(2);
    expect(audit.qualityExclusionPairs).toHaveLength(1);
  });

  it("does not auto-merge conflicting institution qualifiers without a shared trial", () => {
    const audit = buildInvestigatorDedupeAudit([
      profile("a", "Talita D Silva, PhD", "University of Sao Paulo", ["NCT1"]),
      profile("b", "Talita D Silva, MD", "Federal University of Sao Paulo", ["NCT2"]),
    ]);
    expect(audit.autoMergePairs).toHaveLength(0);
    expect(audit.reviewPairs[0].reasons).toContain("institution qualifier mismatch");
  });

  it("reviews conflicting middle initials at the same institution", () => {
    const audit = buildInvestigatorDedupeAudit([
      profile("a", "Kristianne KS Fernandes, PhD", "University of Nove de Julho", ["NCT1"]),
      profile("b", "Kristianne PS Fernandes, PhD", "University of Nove de Julho", ["NCT2"]),
    ]);
    expect(audit.autoMergePairs).toHaveLength(0);
    expect(audit.reviewPairs[0].reasons).toContain("conflicting middle initials");
  });
});
