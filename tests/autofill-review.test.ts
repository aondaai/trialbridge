import { describe, it, expect } from "vitest";
import {
  eligibleForBulkApprove,
  approveAnswer,
  editAnswer,
  bulkApproveHighConfidence,
  NarrativeAutoApproveError,
  type ReviewAnswer,
} from "@/lib/feasibility-autofill/review";

const mk = (over: Partial<ReviewAnswer>): ReviewAnswer => ({
  fieldId: "f",
  archetype: "B",
  status: "proposed",
  confidence: "high",
  version: 1,
  ...over,
});

describe("F4-3 · review HITL — D is never auto-approved", () => {
  it("high-confidence A/B/C are bulk-approvable; D never is", () => {
    expect(eligibleForBulkApprove(mk({ archetype: "A" }))).toBe(true);
    expect(eligibleForBulkApprove(mk({ archetype: "B" }))).toBe(true);
    expect(eligibleForBulkApprove(mk({ archetype: "C" }))).toBe(true);
    expect(eligibleForBulkApprove(mk({ archetype: "D" }))).toBe(false);
  });

  it("low/medium confidence and non-proposed are excluded from bulk", () => {
    expect(eligibleForBulkApprove(mk({ confidence: "low" }))).toBe(false);
    expect(eligibleForBulkApprove(mk({ confidence: "medium" }))).toBe(false);
    expect(eligibleForBulkApprove(mk({ status: "approved" }))).toBe(false);
  });

  it("bulk approve skips every D answer with a reason", () => {
    const answers = [
      mk({ fieldId: "a", archetype: "A" }),
      mk({ fieldId: "d1", archetype: "D" }),
      mk({ fieldId: "d2", archetype: "D", confidence: "low" }),
      mk({ fieldId: "b", archetype: "B" }),
    ];
    const { approved, skipped } = bulkApproveHighConfidence(answers, "camila");
    expect(approved.map((a) => a.fieldId).sort()).toEqual(["a", "b"]);
    expect(skipped.map((s) => s.fieldId).sort()).toEqual(["d1", "d2"]);
    for (const s of skipped) expect(s.reason).toMatch(/narrative \(D\)/);
    for (const a of approved) expect(a.status).toBe("approved");
  });

  it("a D answer CAN be approved via explicit human approve (that is the sign-off)", () => {
    const d = mk({ archetype: "D", confidence: "low" });
    const approved = approveAnswer(d, "camila");
    expect(approved.status).toBe("approved");
    expect(approved.reviewerId).toBe("camila");
    expect(approved.version).toBe(2);
  });

  it("approving a D answer with no actor throws (never anonymous/auto)", () => {
    expect(() => approveAnswer(mk({ archetype: "D" }), "")).toThrow(NarrativeAutoApproveError);
  });

  it("a reserved automated actor cannot approve D (cron/system/agent are not human)", () => {
    for (const bot of ["system", "cron", "agent", "orchestrator", "MCA"]) {
      expect(() => approveAnswer(mk({ archetype: "D" }), bot)).toThrow(NarrativeAutoApproveError);
    }
    // …but an automated actor may still approve a deterministic A/B/C answer.
    expect(approveAnswer(mk({ archetype: "B" }), "cron").status).toBe("approved");
  });

  it("editing sets status=edited and bumps version (needs re-approval to ship)", () => {
    const edited = editAnswer(mk({ status: "proposed" }), "camila");
    expect(edited.status).toBe("edited");
    expect(edited.version).toBe(2);
    expect(eligibleForBulkApprove(edited)).toBe(false);
  });
});
