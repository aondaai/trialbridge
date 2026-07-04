/**
 * Server-side builder for the sponsor's aggregated view.
 *
 * The sponsor never receives patient rows. This runs on the server, reads the
 * responded sites' patient data to SIMULATE softening, and returns only counts
 * and deltas — a fully serializable view model safe to hand to a client component.
 */

import { getConsultation, loadResponses, StoredResponse } from "@/lib/store";
import { loadAllSites } from "@/lib/data/sites";
import { evaluateDataset, EvaluatedSite } from "@/lib/service";
import { aggregate } from "@/lib/matcher/aggregate";
import { softenableHandles, softenCriterion } from "@/lib/matcher/soften";
import { evaluateCohort } from "@/lib/matcher/engine";
import { estimateFeasibility } from "@/lib/feasibility";
import type { Criterion } from "@/lib/matcher/types";

export interface SofteningRow {
  handle: string;
  label: string;
  rawTexts: string[];
  baselineDefinite: number;
  relaxedDefinite: number;
  newlyDefiniteFromFail: number;
  newlyDefiniteFromUnknown: number;
  newlyPossible: number;
  isHero: boolean;
}

export interface SponsorView {
  consultation: {
    id: string;
    title: string;
    sponsorName: string;
    nct?: string;
    sourceNote?: string;
    criteria: Criterion[];
    heroBottleneckHandle?: string;
  };
  responded: {
    siteId: string;
    siteName: string;
    definite: number | "<5";
    possible: number | "<5";
    candidates: number | "<5";
    live: boolean;
  }[];
  waitingOn: string[];
  totals: {
    definite: number | "<5";
    possible: number | "<5";
    candidates: number | "<5";
    rawCandidates: number;
  };
  feasibility: {
    screeningPool: number;
    incidentOverWindow: number;
    enrollableEstimate: number;
    months: number;
    screenToEnroll: number;
  };
  softening: SofteningRow[];
  baselineCandidates: number;
}

export function buildSponsorView(consultationId: string): SponsorView | null {
  const consultation = getConsultation(consultationId);
  if (!consultation) return null;
  const responses = loadResponses(consultationId);
  const respondedIds = new Set(responses.map((r) => r.siteId));

  // Aggregate straight from the reported response counts (counts-not-rows).
  const agg = aggregate(
    responses.map((r) => ({
      siteId: r.siteId,
      siteName: r.siteName,
      counts: { definite: r.definite, possible: r.possible, excluded: r.excluded, total: r.total },
    })),
  );

  const responded = responses.map((r: StoredResponse, i) => ({
    siteId: r.siteId,
    siteName: r.siteName,
    definite: agg.perSite[i].definite,
    possible: agg.perSite[i].possible,
    candidates: agg.perSite[i].candidates,
    live: r.live,
  }));

  // Which seeded sites haven't responded yet (drives the "waiting on / submit live" story).
  const allSites = loadAllSites();
  const waitingOn = allSites.filter((s) => !respondedIds.has(s.site.id)).map((s) => s.site.name);

  // Softening + feasibility need patient data — server-only — for responded sites.
  const respondedDatasets = allSites.filter((s) => respondedIds.has(s.site.id));
  const evaluated: EvaluatedSite[] = respondedDatasets.map((ds) => evaluateDataset(ds, consultation.criteria));
  const pooledPatients = evaluated.flatMap((e) => e.patients);
  const baseEvals = evaluateCohort(pooledPatients, consultation.criteria);

  const softening: SofteningRow[] = softenableHandles(consultation.criteria)
    .map((h) => {
      const r = softenCriterion(pooledPatients, consultation.criteria, h.handle, baseEvals);
      return {
        handle: r.handle,
        label: r.label,
        rawTexts: r.rawTexts,
        baselineDefinite: r.baseline.definite,
        relaxedDefinite: r.relaxed.definite,
        newlyDefiniteFromFail: r.newlyDefiniteFromFail,
        newlyDefiniteFromUnknown: r.newlyDefiniteFromUnknown,
        newlyPossible: r.newlyPossible,
        isHero: r.handle === consultation.heroBottleneckHandle,
      };
    })
    .sort((a, b) => b.relaxedDefinite - a.relaxedDefinite);

  // Feasibility totals across responded sites (R1 funnel + R2 rate).
  let screeningPool = 0;
  let incidentOverWindow = 0;
  let enrollableEstimate = 0;
  const months = 6;
  for (const r of responses) {
    const f = estimateFeasibility({ definite: r.definite, possible: r.possible, monthlyIncidence: r.monthlyIncidence, months });
    screeningPool += f.screeningPool;
    incidentOverWindow += f.incidentOverWindow;
    enrollableEstimate += f.enrollableEstimate;
  }

  const rawCandidates = responses.reduce((s, r) => s + r.definite + r.possible, 0);

  return {
    consultation: {
      id: consultation.id,
      title: consultation.title,
      sponsorName: consultation.sponsorName,
      nct: consultation.nct,
      sourceNote: consultation.sourceNote,
      criteria: consultation.criteria,
      heroBottleneckHandle: consultation.heroBottleneckHandle,
    },
    responded,
    waitingOn,
    totals: {
      definite: agg.totalDefinite,
      possible: agg.totalPossible,
      candidates: agg.totalCandidates,
      rawCandidates,
    },
    feasibility: { screeningPool, incidentOverWindow, enrollableEstimate, months, screenToEnroll: 0.3 },
    softening,
    baselineCandidates: rawCandidates,
  };
}
