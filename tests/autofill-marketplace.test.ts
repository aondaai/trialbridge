import { describe, it, expect } from "vitest";
import {
  buildScorecardContribution,
  type AnsweredField,
} from "@/lib/feasibility-autofill/scorecardFeed";
import { consultationToInboxItem, buildInbox } from "@/lib/feasibility-autofill/inbox";
import { siteDeclared, modeled, Provenance, Confidence } from "@/lib/metric";
import type { StoredConsultation, StoredResponse } from "@/lib/store";
import type { Criterion } from "@/lib/matcher/types";

const ANSWERS: AnsweredField[] = [
  { fieldId: "inst", archetype: "A", metric: siteDeclared("profile.institution_name", "iHealth", Confidence.HIGH) },
  { fieldId: "ibd", archetype: "B", metric: siteDeclared("capability.ibd", "yes", Confidence.HIGH) },
  { fieldId: "n", archetype: "C", metric: modeled("cohort.candidates", 42, Confidence.HIGH, { unit: "patients" }) },
];

describe("F6-1 · scorecard feed reuses Metric (no fork)", () => {
  it("builds a provenanced contribution that passes the gate", () => {
    const c = buildScorecardContribution("s1", "req1", ANSWERS);
    expect(c.candidateMetric?.value).toBe(42);
    expect(c.supportingMetrics).toHaveLength(2);
    // provenance index uses the existing 5-seal vocabulary
    expect(c.provenance.total).toBe(3);
    expect(c.provenance.bySeal[Provenance.SITE_DECLARED]).toBe(2);
    expect(c.provenance.bySeal[Provenance.MODELED]).toBe(1);
  });

  it("handles 'no cohort yet' without tripping the provenance gate", () => {
    const noC = ANSWERS.filter((a) => a.archetype !== "C");
    const c = buildScorecardContribution("s1", "req1", noC);
    expect(c.candidateMetric).toBeNull();
    expect(c.supportingMetrics).toHaveLength(2);
  });
});

const CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast", rawText: "Câncer de mama", confidence: 1 },
];

const CONSULT: StoredConsultation = {
  id: "cons1",
  sponsorName: "MSD",
  title: "ASCVD RWE study",
  nct: "NCT01234567",
  protocolText: "…",
  criteria: CRITERIA,
  createdAt: "2026-07-01T00:00:00Z",
};

const RESP: StoredResponse = {
  id: "r1",
  consultationId: "cons1",
  siteId: "s1",
  siteName: "iHealth",
  definite: 10,
  possible: 5,
  excluded: 2,
  total: 17,
  bottleneckHandle: null,
  bottleneckLabel: null,
  monthlyIncidence: 3,
  live: true,
  submittedAt: "2026-07-02T00:00:00Z",
};

describe("F6-2 · inbox reuses Consultation/Response primitives", () => {
  it("maps a consultation to an inbox item (request id IS the consultation id)", () => {
    const item = consultationToInboxItem(CONSULT, []);
    expect(item.requestId).toBe("cons1");
    expect(item.sponsorName).toBe("MSD");
    expect(item.therapeuticArea).toBe("breast");
    expect(item.status).toBe("new");
  });

  it("marks responded when this site already answered (from the Response store)", () => {
    const item = consultationToInboxItem(CONSULT, [RESP]);
    expect(item.responded).toBe(true);
    expect(item.status).toBe("responded");
  });

  it("buildInbox scopes the responded flag to the site and sorts newest-first", () => {
    const older: StoredConsultation = { ...CONSULT, id: "cons0", createdAt: "2026-06-01T00:00:00Z" };
    const inbox = buildInbox([older, CONSULT], [RESP], "s1");
    expect(inbox.map((i) => i.requestId)).toEqual(["cons1", "cons0"]); // newest first
    expect(inbox.find((i) => i.requestId === "cons1")!.responded).toBe(true);
    // a different site sees no response
    const otherSite = buildInbox([CONSULT], [RESP], "s2");
    expect(otherSite[0].responded).toBe(false);
  });
});
