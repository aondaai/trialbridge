/**
 * EU Clinical Trials Register (EudraCT) adapter — Phase 3 registry breadth.
 *
 * Same discipline as the ctgov adapter (ADR 3B): try live, fall back to a
 * committed, verified fixture ONLY for a known EudraCT id, else throw rather
 * than fabricate. The EU register exposes no clean public JSON API (unlike
 * ClinicalTrials.gov), so the live path is best-effort — it fetches the plain
 * download and runs the eligibility locator over it; any failure drops to the
 * cached fixture. Eligibility here is prose, so this is the `eligibilityText`
 * lane (→ parse.ts), not a structured one.
 */

import { EUCTR_FIXTURE } from "@/data/intakeFixtures";
import { locateEligibilityHeuristic } from "../locateEligibility";
import type { IntakeInput, IntakeResult, SourceAdapter } from "../types";

const EUDRACT_RE = /^\s*(\d{4}-\d{6}-\d{2})\s*$/;
const EUDRACT_IN_URL_RE = /clinicaltrialsregister\.eu\/.*?(\d{4}-\d{6}-\d{2})/i;
const TIMEOUT_MS = 8000;

function eudractIdFrom(input: IntakeInput): string | null {
  if (input.kind === "id") {
    const m = input.id.match(EUDRACT_RE);
    if (m) return m[1];
  }
  if (input.kind === "url") {
    const m = input.url.match(EUDRACT_IN_URL_RE);
    if (m) return m[1];
  }
  return null;
}

/** Best-effort live fetch of the EU register plain download; throws on any issue. */
async function fetchEuctrLive(id: string): Promise<{ title: string; eligibilityText: string; sourceUrl: string }> {
  const sourceUrl = `https://www.clinicaltrialsregister.eu/ctr-search/rest/download/full?query=${id}&mode=current`;
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`EU CTR returned ${res.status} for ${id}`);
  const body = await res.text();
  const located = locateEligibilityHeuristic(body);
  if (!located.found) throw new Error(`EU CTR download for ${id} had no locatable eligibility section`);
  const titleMatch = body.match(/A\.3\s+Full title[^\n]*\n\s*(.+)/i);
  return {
    title: titleMatch?.[1]?.trim() || `EudraCT ${id}`,
    eligibilityText: located.text,
    sourceUrl: `https://www.clinicaltrialsregister.eu/ctr-search/trial/${id}/results`,
  };
}

export const euctrAdapter: SourceAdapter = {
  id: "euctr",

  detect(input) {
    return eudractIdFrom(input) ? 1 : 0;
  },

  async extract(input): Promise<IntakeResult> {
    const id = eudractIdFrom(input);
    if (!id) throw new Error("euctr adapter: input is not a EudraCT number or EU CTR URL");

    try {
      const live = await fetchEuctrLive(id);
      return {
        metadata: { sourceId: id, sourceRegistry: "eudract", title: live.title, sourceUrl: live.sourceUrl },
        eligibilityText: live.eligibilityText,
        provenance: { adapter: "euctr", extraction: "api", trust: "high", note: `Live EU Clinical Trials Register (${live.sourceUrl}).` },
      };
    } catch (err) {
      if (id === EUCTR_FIXTURE.eudractNumber) {
        return {
          metadata: {
            sourceId: id,
            sourceRegistry: "eudract",
            title: EUCTR_FIXTURE.title,
            sponsor: EUCTR_FIXTURE.sponsor,
            conditions: [...EUCTR_FIXTURE.conditions],
            sourceUrl: EUCTR_FIXTURE.sourceUrl,
          },
          eligibilityText: EUCTR_FIXTURE.eligibilityText,
          provenance: {
            adapter: "euctr",
            extraction: "api",
            trust: "high",
            note: `Live EU CTR fetch failed (${(err as Error).message}); fell back to the cached, verified ${id} fixture.`,
          },
        };
      }
      throw new Error(`Could not fetch EudraCT ${id} from the EU Clinical Trials Register: ${(err as Error).message}`);
    }
  },
};
