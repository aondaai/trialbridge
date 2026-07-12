/**
 * Feasibility inbox (F6-2) — reuses the marketplace primitives, no parallel dispatch table.
 *
 * A sponsor "feasibility request" is the same event as the existing marketplace primitive:
 * a sponsor posting a study (`StoredConsultation`, with its parsed `Criterion[]`). Rather
 * than introduce a separate sponsor-dispatch table, the inbox is a VIEW over consultations —
 * each becomes an InboxItem the site coordinator reviews. Site responses continue to flow
 * through the existing counts-not-rows `StoredResponse`. This keeps one source of truth for
 * the two-sided loop (reconciliation doc F6).
 *
 * Pure mapping; the route/store supplies the consultations and any per-request answer status.
 */

import type { StoredConsultation, StoredResponse } from "@/lib/store";
import type { Criterion } from "@/lib/matcher/types";

export interface InboxItem {
  /** Reuses the consultation id — the request IS the consultation, not a new entity. */
  requestId: string;
  sponsorName: string;
  studyTitle: string;
  nct?: string;
  therapeuticArea: string | null;
  criteria: Criterion[];
  createdAt: string;
  /** Whether this site has already responded (from the existing Response store). */
  responded: boolean;
  /** Review status derived from the response, if any. */
  status: "new" | "responded";
}

/** Infer a coarse therapeutic area from the criteria diagnoses (best-effort, optional). */
function inferTherapeuticArea(criteria: Criterion[]): string | null {
  const dx = criteria.find((c) => c.field === "diagnosis");
  if (dx && typeof dx.value === "string") return dx.value;
  return null;
}

/** Map one consultation (+ this site's responses) into an inbox item. */
export function consultationToInboxItem(
  consultation: StoredConsultation,
  siteResponses: StoredResponse[],
): InboxItem {
  const responded = siteResponses.some((r) => r.consultationId === consultation.id);
  return {
    requestId: consultation.id,
    sponsorName: consultation.sponsorName,
    studyTitle: consultation.title,
    nct: consultation.nct,
    therapeuticArea: inferTherapeuticArea(consultation.criteria),
    criteria: consultation.criteria,
    createdAt: consultation.createdAt,
    responded,
    status: responded ? "responded" : "new",
  };
}

/**
 * Build a site's inbox from all consultations + that site's responses. Newest first.
 * `siteId` scopes the "responded" flag to this site (multi-tenant isolation).
 */
export function buildInbox(
  consultations: StoredConsultation[],
  responses: StoredResponse[],
  siteId: string,
): InboxItem[] {
  const mine = responses.filter((r) => r.siteId === siteId);
  return consultations
    .map((c) => consultationToInboxItem(c, mine))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
