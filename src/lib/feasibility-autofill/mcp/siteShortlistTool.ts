import type { NationalEstimate } from "@/lib/estimator/client";
import { buildSiteRegistryLandscape } from "@/lib/site-feasibility/buildLandscape";
import { inferConditionFromTitle, siteFeasibilityQueryFromProtocol } from "@/lib/site-feasibility/query";
import { buildSitePrequalificationShortlist } from "@/lib/site-feasibility/shortlist";
import type { SitePrequalificationShortlist } from "@/lib/site-feasibility/types";

export interface SelectionConsultation {
  id: string;
  title: string;
  nct?: string | null;
  estimateResult?: NationalEstimate | null;
}

export interface SiteShortlistRequest {
  consultationId: string;
  limit?: number;
}

export interface SiteShortlistResult {
  schemaVersion: "site-selection-tool.v1";
  consultationId: string;
  nct: string | null;
  status: "proposed";
  humanApprovalRequired: true;
  shortlist: SitePrequalificationShortlist;
}

export type ConsultationLoader = (id: string) => Promise<SelectionConsultation | null | undefined>;

export async function runSiteShortlist(
  request: SiteShortlistRequest,
  loadConsultation: ConsultationLoader,
): Promise<SiteShortlistResult> {
  const consultationId = request.consultationId?.trim();
  if (!consultationId) throw new Error("consultationId required");
  const limit = request.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be an integer between 1 and 50");

  const consultation = await loadConsultation(consultationId);
  if (!consultation) throw new Error(`unknown consultation "${consultationId}"`);
  const estimate = consultation.estimateResult;
  if (!estimate || estimate.eligibilityFractionApplied === false) {
    throw new Error("a validated regional eligibility estimate is required before site selection");
  }

  const phase = phaseFromTitle(consultation.title);
  const query = siteFeasibilityQueryFromProtocol({
    condition: inferConditionFromTitle(consultation.title),
    title: consultation.title,
    nctId: consultation.nct,
    phase,
  });
  const landscape = await buildSiteRegistryLandscape(query, { asOf: estimate.asOf });
  const shortlist = buildSitePrequalificationShortlist(
    landscape,
    estimate.byRegion.map((region) => ({
      uf: region.region,
      eligible: region.estimatedN,
      asOf: estimate.asOf,
      sourceLabel: `${estimate.dataSource} — TrialBridge estimator (${estimate.protocolId})`,
      sourceVersion: estimate.asOf,
    })),
    { limit, asOf: estimate.asOf },
  );

  return {
    schemaVersion: "site-selection-tool.v1",
    consultationId,
    nct: consultation.nct ?? null,
    status: "proposed",
    humanApprovalRequired: true,
    shortlist,
  };
}

function phaseFromTitle(title: string): string | null {
  if (/phase\s*3|phase\s*iii/i.test(title)) return "III";
  if (/phase\s*2|phase\s*ii/i.test(title)) return "II";
  if (/phase\s*1|phase\s*i/i.test(title)) return "I";
  return null;
}

export const SITE_SHORTLIST_TOOL = {
  name: "site.shortlist",
  description:
    "Return a deterministic, provenanced site prequalification shortlist for a sponsor-reviewed consultation. " +
    "The result is always proposed and requires human approval; the model cannot override or recompute scores.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      consultationId: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["consultationId"],
  },
} as const;
