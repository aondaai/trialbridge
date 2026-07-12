import { describe, it, expect, beforeEach } from "vitest";
import { locateEligibility, locateEligibilityHeuristic } from "@/lib/intake/locateEligibility";

const FULL_PROTOCOL = `PROTOCOL DS-1234
A Phase III Study

1. Background
Some long background prose about the disease and the drug that is not eligibility.

2. Objectives
Primary objective is overall survival.

3. Study Population

Inclusion Criteria:
- Age >= 18 years.
- HER2-positive (IHC 3+).
- ECOG 0 or 1.

Exclusion Criteria:
- Active brain metastases.
- LVEF < 50%.

4. Study Design
This is a randomized, open-label study with statistical details following.
`;

describe("locateEligibilityHeuristic", () => {
  it("extracts just the eligibility block from a full protocol", () => {
    const r = locateEligibilityHeuristic(FULL_PROTOCOL);
    expect(r.found).toBe(true);
    expect(r.method).toBe("heuristic");
    expect(r.text).toMatch(/Inclusion Criteria/);
    expect(r.text).toMatch(/Exclusion Criteria/);
    expect(r.text).toMatch(/LVEF < 50%/);
    // Must NOT bleed into surrounding sections.
    expect(r.text).not.toMatch(/Background/);
    expect(r.text).not.toMatch(/Study Design/);
    expect(r.text).not.toMatch(/overall survival/);
  });

  it("passes text through verbatim when there is no eligibility heading", () => {
    const r = locateEligibilityHeuristic("Just some notes with no criteria headings at all.");
    expect(r.found).toBe(false);
    expect(r.method).toBe("verbatim");
    expect(r.text).toMatch(/Just some notes/);
  });

  it("handles an eligibility heading with no explicit exclusion section (edge case)", () => {
    const r = locateEligibilityHeuristic("Eligibility\n- Adults 18+\n- Confirmed diagnosis\n");
    expect(r.found).toBe(true);
    expect(r.note).toMatch(/no explicit exclusion/i);
    expect(r.text).toMatch(/Adults 18\+/);
  });

  it("locates EU CTR-style 'E.3 Principal inclusion criteria' headings (polish C)", () => {
    const euctr = `E.2 Objectives
Primary objective is survival.

E.3 Principal inclusion criteria
- Age >= 18 years.
- Confirmed diagnosis.

E.4 Principal exclusion criteria
- Prior systemic therapy.

E.5 End points
Primary endpoint is OS.`;
    const r = locateEligibilityHeuristic(euctr);
    expect(r.found).toBe(true);
    expect(r.text).toMatch(/inclusion criteria/i);
    expect(r.text).toMatch(/exclusion criteria/i);
    expect(r.text).toMatch(/Prior systemic therapy/);
    expect(r.text).not.toMatch(/Objectives/);
  });
});

describe("locateEligibility (async wrapper)", () => {
  beforeEach(() => delete process.env.ANTHROPIC_API_KEY);

  it("uses the heuristic when no API key is present, even if useLlm is requested", async () => {
    const r = await locateEligibility(FULL_PROTOCOL, { useLlm: true });
    expect(r.method).toBe("heuristic");
    expect(r.text).toMatch(/Exclusion Criteria/);
  });
});
