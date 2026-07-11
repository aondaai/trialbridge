/**
 * In-process orchestrator dependencies — the local (single-process) binding used by the autofill
 * server action, the demo seed, and the e2e driver. Unlike liveDeps.ts (which reaches archetype C
 * over the MCP subprocess for the cloud/site split), this runs C in-process via the site's own
 * loader — still server-side on the site's own data, still aggregates-only. D uses the template
 * drafter / heuristic critic (no key), so this path makes no outbound Anthropic calls.
 */

import { prisma } from "@/lib/db";
import { loadSite } from "@/lib/data/sites";
import { resolveCohort, toCohortPreview } from "./resolvers/cohort";
import type { OrchestratorDeps } from "./mcp/orchestrator";

export function buildInProcessDeps(asOf: string): OrchestratorDeps {
  return {
    loadProfile: async (siteId) => {
      const p = await prisma.institutionProfile.findFirst({ where: { siteId }, orderBy: { version: "desc" } });
      return p
        ? {
            legalName: p.legalName, address: p.address, email: p.email, phone: p.phone, website: p.website,
            anonymizationLevel: p.anonymizationLevel, lgpdBasis: p.lgpdBasis, ethicsCommittee: p.ethicsCommittee,
            contractingDaysEst: p.contractingDaysEst, acceptsEsignature: p.acceptsEsignature, materials: p.materials,
          }
        : null;
    },
    loadCapability: async (siteId, concept) => {
      const r = await prisma.capabilityCatalog.findFirst({ where: { siteId, conceptId: concept }, orderBy: { lastValidatedAt: "desc" } });
      return r
        ? { conceptId: r.conceptId, available: r.available, identificationMethod: r.identificationMethod, sourceField: r.sourceField, completenessValue: r.completenessValue, completenessQual: r.completenessQual, notes: r.notes }
        : null;
    },
    cohortPreview: async (siteId, criteria) => {
      const ds = await loadSite(siteId);
      if (!ds) throw new Error(`unknown site ${siteId}`);
      return toCohortPreview(resolveCohort(ds.patients, criteria, asOf));
    },
    loadPriors: async (siteId) => {
      const rows = await prisma.priorFormAnswer.findMany({ where: { siteId } });
      return rows.map((r) => ({ id: r.id, section: r.section, label: r.label, conceptId: r.conceptId, answerText: r.answerText }));
    },
    asOf,
  };
}
