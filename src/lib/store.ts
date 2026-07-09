/**
 * The consultations & responses store — the marketplace layer.
 *
 * Persistence is now a real database (Prisma over SQLite, prisma/dev.db) — the
 * post-hackathon swap target from ADR-001 Decision 2, now in place. The store
 * starts EMPTY; every consultation and response is created live by real users.
 *
 * PRIVACY BY CONSTRUCTION: a `StoredResponse` carries COUNTS and a bottleneck
 * reference — never patient rows. A sponsor reading responses physically cannot
 * reach row-level patient data because it was never written here. Patient rows
 * live only in the per-site Patient table (the site's own origin).
 *
 * Functions are async (Prisma is async). All callers run in async-capable
 * contexts: server components, route handlers, and server actions.
 */

import { prisma } from "@/lib/db";
import type { Criterion } from "@/lib/matcher/types";

export interface StoredConsultation {
  id: string;
  sponsorName: string;
  title: string;
  nct?: string;
  sourceNote?: string;
  protocolText: string;
  criteria: Criterion[];
  /** The intended hero bottleneck handle, for the softening UI default. */
  heroBottleneckHandle?: string;
  createdAt: string;
}

export interface StoredResponse {
  id: string;
  consultationId: string;
  siteId: string;
  siteName: string;
  // counts-not-rows — the whole privacy model in five fields:
  definite: number;
  possible: number;
  excluded: number;
  total: number;
  bottleneckHandle: string | null;
  bottleneckLabel: string | null;
  monthlyIncidence: number;
  /** true when submitted live in the UI, false for programmatic/seed writes. */
  live: boolean;
  submittedAt: string;
}

// ---- row <-> domain mapping -------------------------------------------------

type ConsultationRow = {
  id: string;
  sponsorName: string;
  title: string;
  nct: string | null;
  sourceNote: string | null;
  protocolText: string;
  criteria: string;
  heroBottleneckHandle: string | null;
  createdAt: Date;
};

function toStoredConsultation(row: ConsultationRow): StoredConsultation {
  return {
    id: row.id,
    sponsorName: row.sponsorName,
    title: row.title,
    nct: row.nct ?? undefined,
    sourceNote: row.sourceNote ?? undefined,
    protocolText: row.protocolText,
    criteria: JSON.parse(row.criteria) as Criterion[],
    heroBottleneckHandle: row.heroBottleneckHandle ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

type ResponseRow = {
  id: string;
  consultationId: string;
  siteId: string;
  siteName: string;
  definite: number;
  possible: number;
  excluded: number;
  total: number;
  bottleneckHandle: string | null;
  bottleneckLabel: string | null;
  monthlyIncidence: number;
  live: boolean;
  submittedAt: Date;
};

function toStoredResponse(row: ResponseRow): StoredResponse {
  return {
    id: row.id,
    consultationId: row.consultationId,
    siteId: row.siteId,
    siteName: row.siteName,
    definite: row.definite,
    possible: row.possible,
    excluded: row.excluded,
    total: row.total,
    bottleneckHandle: row.bottleneckHandle,
    bottleneckLabel: row.bottleneckLabel,
    monthlyIncidence: row.monthlyIncidence,
    live: row.live,
    submittedAt: row.submittedAt.toISOString(),
  };
}

// ---- consultations ----------------------------------------------------------

export async function loadConsultations(): Promise<StoredConsultation[]> {
  const rows = await prisma.consultation.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toStoredConsultation);
}

export async function getConsultation(id: string): Promise<StoredConsultation | undefined> {
  const row = await prisma.consultation.findUnique({ where: { id } });
  return row ? toStoredConsultation(row) : undefined;
}

/** Upsert each consultation in the list (idempotent by id). */
export async function writeConsultations(list: StoredConsultation[]): Promise<void> {
  for (const c of list) {
    const data = {
      sponsorName: c.sponsorName,
      title: c.title,
      nct: c.nct ?? null,
      sourceNote: c.sourceNote ?? null,
      protocolText: c.protocolText,
      criteria: JSON.stringify(c.criteria),
      heroBottleneckHandle: c.heroBottleneckHandle ?? null,
      createdAt: new Date(c.createdAt),
    };
    await prisma.consultation.upsert({
      where: { id: c.id },
      create: { id: c.id, ...data },
      update: data,
    });
  }
}

// ---- responses --------------------------------------------------------------

export async function loadResponses(consultationId?: string): Promise<StoredResponse[]> {
  const rows = await prisma.response.findMany({
    where: consultationId ? { consultationId } : undefined,
  });
  return rows.map(toStoredResponse);
}

/** Replace the whole responses set with `list` (used by bulk rewrites). */
export async function writeResponses(list: StoredResponse[]): Promise<void> {
  await prisma.$transaction([
    prisma.response.deleteMany({}),
    ...list.map((r) =>
      prisma.response.create({
        data: {
          id: r.id,
          consultationId: r.consultationId,
          siteId: r.siteId,
          siteName: r.siteName,
          definite: r.definite,
          possible: r.possible,
          excluded: r.excluded,
          total: r.total,
          bottleneckHandle: r.bottleneckHandle,
          bottleneckLabel: r.bottleneckLabel,
          monthlyIncidence: r.monthlyIncidence,
          live: r.live,
          submittedAt: new Date(r.submittedAt),
        },
      }),
    ),
  ]);
}

export async function hasResponded(consultationId: string, siteId: string): Promise<boolean> {
  const row = await prisma.response.findUnique({
    where: { consultationId_siteId: { consultationId, siteId } },
  });
  return row !== null;
}

/**
 * Insert or replace a site's response to a consultation (idempotent per site).
 * This is the write path used by the live "submit capacity" action. Returns the
 * responses for that consultation.
 */
export async function upsertResponse(resp: StoredResponse): Promise<StoredResponse[]> {
  const data = {
    consultationId: resp.consultationId,
    siteId: resp.siteId,
    siteName: resp.siteName,
    definite: resp.definite,
    possible: resp.possible,
    excluded: resp.excluded,
    total: resp.total,
    bottleneckHandle: resp.bottleneckHandle,
    bottleneckLabel: resp.bottleneckLabel,
    monthlyIncidence: resp.monthlyIncidence,
    live: resp.live,
    submittedAt: new Date(resp.submittedAt),
  };
  await prisma.response.upsert({
    where: { consultationId_siteId: { consultationId: resp.consultationId, siteId: resp.siteId } },
    create: { id: resp.id, ...data },
    update: data,
  });
  return loadResponses(resp.consultationId);
}
