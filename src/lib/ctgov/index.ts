/**
 * "Read the protocol from ClinicalTrials.gov" — the fetch-by-NCT-id entry
 * point, applying the same live/cached-fallback discipline as the parse
 * service (ADR Decision 3B): fetch live; on failure, fall back to a
 * committed, human-verified fixture ONLY for the NCT ids TrialBridge already
 * ships as hero protocols. Any other id that fails to fetch surfaces a clear
 * error rather than fabricating a cache — there is nothing honest to fall
 * back to for a trial nobody has verified.
 */

import { fetchStudy } from "./client";
import { normalizeStudy } from "./normalize";
import { HERO_META, HERO_PROTOCOL_TEXT } from "@/data/hero-protocol";
import { NSCLC_META, NSCLC_PROTOCOL_TEXT } from "@/data/nsclc-kras-protocol";
import type { NormalizedProtocol, FetchProtocolResult } from "./types";

export type { NormalizedProtocol, FetchProtocolResult, RawCtGovStudy } from "./types";

interface HeroFixture {
  nct: string;
  title: string;
  sponsorName: string;
  text: string;
}

const HERO_FIXTURES: HeroFixture[] = [
  { nct: HERO_META.nct, title: HERO_META.title, sponsorName: HERO_META.sponsorName, text: HERO_PROTOCOL_TEXT },
  { nct: NSCLC_META.nct, title: NSCLC_META.title, sponsorName: NSCLC_META.sponsorName, text: NSCLC_PROTOCOL_TEXT },
];

function cachedFallback(nctId: string): NormalizedProtocol | null {
  const id = nctId.trim().toUpperCase();
  const hit = HERO_FIXTURES.find((f) => f.nct.toUpperCase() === id);
  if (!hit) return null;
  return {
    nctId: hit.nct,
    title: hit.title,
    briefTitle: hit.title,
    sponsor: hit.sponsorName,
    phase: [],
    status: null,
    conditions: [],
    eligibilityCriteria: hit.text,
    minimumAge: null,
    maximumAge: null,
    sex: null,
    sourceUrl: `https://clinicaltrials.gov/study/${hit.nct}`,
  };
}

/** Fetch a protocol by NCT id. Live first; cached hero fixture on failure; else throws. */
export async function fetchProtocol(nctId: string): Promise<FetchProtocolResult> {
  const id = nctId.trim();
  if (!id) throw new Error("nctId is required");

  try {
    const raw = await fetchStudy(id);
    const protocol = normalizeStudy(raw);
    return {
      protocol,
      source: "live",
      note: `Fetched live from ClinicalTrials.gov (${protocol.sourceUrl}).`,
    };
  } catch (err) {
    const fallback = cachedFallback(id);
    if (fallback) {
      return {
        protocol: fallback,
        source: "cached",
        note: `Live fetch failed (${(err as Error).message}); fell back to the cached, human-verified ${fallback.nctId} fixture.`,
      };
    }
    throw new Error(`Could not fetch ${id} from ClinicalTrials.gov: ${(err as Error).message}`);
  }
}
