/**
 * Thin Prisma bindings for the deterministic A/B resolvers.
 *
 * This is the ONLY resolver file that touches Prisma; the resolver logic in
 * ./profile.ts and ./capability.ts stays pure (row in → Metric out) so it is
 * offline-testable and honors the repo purity discipline. Server code (routes,
 * the autofill job) calls these; unit tests call the pure functions directly.
 */

import { prisma } from "@/lib/db";
import type { Metric } from "@/lib/metric";
import { resolveProfileByLabel, type ProfileLike } from "./profile";
import { resolveCapability, type CapabilityLike } from "./capability";

/** Load a site's institution profile and resolve one A-field by its form label. */
export async function resolveProfileFieldForSite(
  siteId: string,
  label: string,
): Promise<Metric<string | number | null> | null> {
  const profile = await prisma.institutionProfile.findFirst({
    where: { siteId },
    orderBy: { updatedAt: "desc" },
  });
  if (!profile) return null;
  const like: ProfileLike = {
    legalName: profile.legalName,
    address: profile.address,
    email: profile.email,
    phone: profile.phone,
    website: profile.website,
    anonymizationLevel: profile.anonymizationLevel,
    lgpdBasis: profile.lgpdBasis,
    ethicsCommittee: profile.ethicsCommittee,
    contractingDaysEst: profile.contractingDaysEst,
    acceptsEsignature: profile.acceptsEsignature,
    materials: profile.materials,
  };
  return resolveProfileByLabel(like, label, profile.updatedAt.toISOString());
}

/** Load a site's capability row for a concept and resolve the B-field. */
export async function resolveCapabilityForSite(
  siteId: string,
  concept: string,
): Promise<Metric<string | null>> {
  const row = await prisma.capabilityCatalog.findFirst({
    where: { siteId, conceptId: concept },
    orderBy: { lastValidatedAt: "desc" },
  });
  const like: CapabilityLike | null = row
    ? {
        conceptId: row.conceptId,
        available: row.available,
        identificationMethod: row.identificationMethod,
        sourceField: row.sourceField,
        completenessValue: row.completenessValue,
        completenessQual: row.completenessQual,
        notes: row.notes,
      }
    : null;
  return resolveCapability(concept, like, row?.lastValidatedAt.toISOString() ?? null);
}
