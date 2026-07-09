/**
 * Thin client for the public ClinicalTrials.gov REST API v2. No auth, no
 * rate-limit handling beyond a timeout — this is a read of public data, not
 * the LLM-parse step, so the ADR's "isolate the risky step" concern doesn't
 * apply here; the risk this module manages is availability, handled by the
 * cached-fallback wrapper in `./index.ts`.
 */

import type { RawCtGovStudy } from "./types";

const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT_MS = 8000;

/** Fetch one study by NCT id. Throws on non-200, timeout, or a payload missing protocolSection. */
export async function fetchStudy(nctId: string): Promise<RawCtGovStudy> {
  const id = nctId.trim().toUpperCase();
  const res = await fetch(`${CTGOV_BASE}/${id}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ClinicalTrials.gov returned ${res.status} for ${id}`);
  }
  const json = (await res.json()) as RawCtGovStudy;
  if (!json.protocolSection) {
    throw new Error(`ClinicalTrials.gov response for ${id} has no protocolSection`);
  }
  return json;
}
