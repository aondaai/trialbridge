import { describe, it, expect, beforeEach } from "vitest";
import { defaultRegistry } from "@/lib/intake";
import { documentAdapter } from "@/lib/intake/adapters/document";
import { makePdf, makeDocx } from "./helpers/fixtures";

const PROTOCOL = `PROTOCOL ONC-2026-01
A Phase III Study of Drug X

1. Background
Long background prose that is not eligibility.

3. Study Population

Inclusion Criteria:
- Age >= 18 years.
- HER2-positive (IHC 3+).
- ECOG 0 or 1.

Exclusion Criteria:
- Active brain metastases.
- LVEF < 50%.

4. Study Design
Randomized, open-label.
`;

const SYNOPSIS = `Protocol Synopsis — Drug Y in NSCLC

Eligibility:
- Adults with stage IV NSCLC.
- KRAS G12C mutation confirmed.
- No prior KRAS inhibitor.
`;

beforeEach(() => delete process.env.ANTHROPIC_API_KEY);

describe("document adapter — born-digital protocol PDF", () => {
  it("extracts the eligibility block and lands on the eligibilityText lane", async () => {
    const result = await defaultRegistry().ingest({
      kind: "file",
      filename: "protocol.pdf",
      bytes: makePdf(PROTOCOL),
    });
    expect(result.provenance.adapter).toBe("document");
    expect(result.preParsedCriteria).toBeUndefined();
    expect(result.eligibilityText).toMatch(/Inclusion Criteria/);
    expect(result.eligibilityText).toMatch(/Exclusion Criteria/);
    expect(result.eligibilityText).not.toMatch(/Background/);
    expect(result.eligibilityText).not.toMatch(/Study Design/);
    expect(result.metadata.title).toBe("protocol"); // from filename
    expect(result.provenance.trust).toBe("medium"); // born-digital, headings found
  });

  it("works from a DOCX too", async () => {
    const docx = makeDocx([
      "Inclusion Criteria:",
      "Age >= 18 years.",
      "Exclusion Criteria:",
      "Active brain metastases.",
    ]);
    const result = await documentAdapter.extract({ kind: "file", filename: "p.docx", bytes: docx });
    expect(result.eligibilityText).toMatch(/Active brain metastases/);
  });
});

describe("document adapter — synopsis / pasted text", () => {
  it("handles a short synopsis where eligibility is the whole thing", async () => {
    const result = await defaultRegistry().ingest({ kind: "text", text: SYNOPSIS });
    expect(result.provenance.adapter).toBe("document");
    expect(result.eligibilityText).toMatch(/KRAS G12C/);
    expect(result.metadata.sourceRegistry).toBe("document");
  });

  it("scores below ctgov for an NCT id but claims plain text", () => {
    expect(documentAdapter.detect({ kind: "id", id: "NCT03529110" })).toBe(0);
    expect(documentAdapter.detect({ kind: "text", text: "anything" })).toBe(0.5);
  });
});
