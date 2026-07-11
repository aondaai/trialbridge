/**
 * Cross-reference CT.gov investigators against the imported site directory.
 *
 * A CT.gov investigator carries a free-text affiliation ("Barretos Cancer Hospital").
 * Matching it to a directory site (→ "FUNDACAO PIO XII BARRETOS", CNES 2090236) gives
 * us (a) the real CNES code, (b) an accurate macro-region (better than the study-site
 * heuristic), and (c) a confirmed institutional link that lifts the KOL's `institution`
 * signal. Pure — the directory is loaded by the caller.
 */

import { DirectorySite, matchAffiliation } from "@/lib/sites/directory";
import type { KolInvestigatorInput } from "@/lib/kol/score";

export interface CrossRefStats {
  total: number;
  linked: number;
}

export function crossReferenceInvestigators(
  inputs: KolInvestigatorInput[],
  directory: DirectorySite[],
): { investigators: KolInvestigatorInput[]; stats: CrossRefStats } {
  let linked = 0;
  const investigators = inputs.map((inv) => {
    const match = matchAffiliation(inv.affiliation, directory);
    if (!match) return inv;
    linked++;
    return {
      ...inv,
      cnes: match.cnes ?? inv.cnes ?? null,
      regionCode: match.region ?? inv.regionCode,
      signals: { ...inv.signals, hasCnesLink: true },
    };
  });
  return { investigators, stats: { total: inputs.length, linked } };
}
