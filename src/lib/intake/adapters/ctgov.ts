/**
 * ClinicalTrials.gov as the FIRST SourceAdapter.
 *
 * This is a thin wrapper over the existing `fetchProtocol` (src/lib/ctgov) — it
 * adds ZERO new fetch/normalize behavior. Its only job is to (a) recognize an
 * NCT id / CT.gov URL and (b) map the existing `NormalizedProtocol` onto the
 * neutral `ProtocolMeta` + `IntakeResult` envelope. The live/cached-fallback
 * discipline (ADR 3B) stays exactly where it already lives.
 */

import { fetchProtocol } from "@/lib/ctgov";
import type { IntakeInput, IntakeResult, SourceAdapter } from "../types";

const NCT_RE = /^\s*NCT\d{8}\s*$/i;
const NCT_IN_URL_RE = /clinicaltrials\.gov\/(?:study|ct2\/show)\/(NCT\d{8})/i;

/** Pull an NCT id out of an id/url input, or null. */
function nctIdFrom(input: IntakeInput): string | null {
  if (input.kind === "id" && NCT_RE.test(input.id)) return input.id.trim().toUpperCase();
  if (input.kind === "url") {
    const m = input.url.match(NCT_IN_URL_RE);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export const ctgovAdapter: SourceAdapter = {
  id: "ctgov",

  detect(input) {
    return nctIdFrom(input) ? 1 : 0;
  },

  async extract(input): Promise<IntakeResult> {
    const nctId = nctIdFrom(input);
    if (!nctId) throw new Error("ctgov adapter: input is not an NCT id or CT.gov URL");

    const { protocol, source, note } = await fetchProtocol(nctId);

    return {
      metadata: {
        sourceId: protocol.nctId,
        sourceRegistry: "clinicaltrials.gov",
        title: protocol.title,
        sponsor: protocol.sponsor,
        phase: protocol.phase,
        conditions: protocol.conditions,
        sourceUrl: protocol.sourceUrl,
      },
      eligibilityText: protocol.eligibilityCriteria,
      provenance: {
        adapter: "ctgov",
        // Registry API read (or a verified cached fixture of one) — high trust.
        extraction: "api",
        trust: "high",
        note: `${source === "live" ? "Live" : "Cached"} ClinicalTrials.gov. ${note}`,
      },
    };
  },
};
