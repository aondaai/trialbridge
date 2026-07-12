/**
 * Live orchestrator dependencies (ADR-002 live seam, integration "A").
 *
 * Binds the orchestrator's injected deps to the REAL backends:
 *   - loadProfile / loadCapability / loadPriors → Prisma (the site DB)
 *   - cohortPreview → the site-side cohort.preview MCP tool via McpStdioClient (aggregates only)
 *   - draft / critique → the built-in resolvers, which call Claude when ANTHROPIC_API_KEY is set
 *     and fall back to the grounded template / heuristic otherwise.
 *
 * This is the whole "make it run live" piece for a local/Node deployment — it needs only an
 * API key, no Managed-Agents beta. The MCA managed-session variant is a separate scaffold
 * (managedSession.ts). Nothing here fabricates data or bypasses the residency boundary: patient
 * rows are reached only inside the MCP server subprocess, which returns aggregates.
 */

import { prisma } from "@/lib/db";
import type { OrchestratorDeps } from "./orchestrator";
import type { ProfileLike } from "../resolvers/profile";
import type { CapabilityLike } from "../resolvers/capability";
import type { PriorAnswer } from "../rag";
import type { CohortPreview } from "../resolvers/cohort";
import { draftNarrative } from "../resolvers/narrative";
import { critiqueNarrative } from "../resolvers/narrativeCritic";
import { McpStdioClient } from "./mcpStdioClient";
import type { Criterion } from "@/lib/matcher/types";

/** Prisma-backed profile loader (latest version). */
async function loadProfile(siteId: string): Promise<ProfileLike | null> {
  const p = await prisma.institutionProfile.findFirst({
    where: { siteId },
    orderBy: { version: "desc" },
  });
  if (!p) return null;
  return {
    legalName: p.legalName,
    address: p.address,
    email: p.email,
    phone: p.phone,
    website: p.website,
    anonymizationLevel: p.anonymizationLevel,
    lgpdBasis: p.lgpdBasis,
    ethicsCommittee: p.ethicsCommittee,
    contractingDaysEst: p.contractingDaysEst,
    acceptsEsignature: p.acceptsEsignature,
    materials: p.materials,
  };
}

/** Prisma-backed capability loader (latest validated row for the concept). */
async function loadCapability(siteId: string, concept: string): Promise<CapabilityLike | null> {
  const row = await prisma.capabilityCatalog.findFirst({
    where: { siteId, conceptId: concept },
    orderBy: { lastValidatedAt: "desc" },
  });
  if (!row) return null;
  return {
    conceptId: row.conceptId,
    available: row.available,
    identificationMethod: row.identificationMethod,
    sourceField: row.sourceField,
    completenessValue: row.completenessValue,
    completenessQual: row.completenessQual,
    notes: row.notes,
  };
}

/** Prisma-backed prior-answer loader (the RAG memory). */
async function loadPriors(siteId: string): Promise<PriorAnswer[]> {
  const rows = await prisma.priorFormAnswer.findMany({ where: { siteId } });
  return rows.map((r) => ({
    id: r.id,
    section: r.section,
    label: r.label,
    conceptId: r.conceptId,
    answerText: r.answerText,
  }));
}

export interface LiveDepsHandle {
  deps: OrchestratorDeps;
  /** Close the MCP subprocess when the run is done. */
  close: () => void;
}

/**
 * Build live deps. Spawns the site-side cohort.preview MCP server and binds every dep to a real
 * backend. `asOf` should be an injected ISO timestamp (the caller stamps it, keeping resolvers
 * clock-free). Remember to call `close()` to tear down the MCP subprocess.
 */
export async function buildLiveDeps(opts: {
  asOf: string;
  tsxBin?: string;
  serverScript?: string;
}): Promise<LiveDepsHandle> {
  const tsx = opts.tsxBin ?? "./node_modules/.bin/tsx";
  const script = opts.serverScript ?? "scripts/mcp-cohort-server.ts";
  const client = new McpStdioClient(tsx, [script]);
  try {
    await client.initialize();
  } catch (err) {
    client.close(); // don't leak the spawned subprocess if the handshake fails/times out
    throw err;
  }

  const cohortPreview = (siteId: string, criteria: Criterion[]): Promise<CohortPreview> =>
    client.callTool<CohortPreview>("cohort.preview", { siteId, criteria });

  const deps: OrchestratorDeps = {
    loadProfile,
    loadCapability,
    cohortPreview,
    loadPriors,
    draft: (ctx) => draftNarrative(ctx), // Claude when keyed, template otherwise
    critique: (draft, ctx) => critiqueNarrative(draft, ctx), // Claude when keyed, heuristic otherwise
    asOf: opts.asOf,
  };

  return { deps, close: () => client.close() };
}
