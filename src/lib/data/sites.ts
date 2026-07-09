/**
 * Server-side loader for site datasets — now backed by the real database
 * (Prisma over SQLite), not the committed data/*.json snapshot.
 *
 * This is the counts-not-rows boundary's *origin*: raw patient rows live in the
 * per-site Patient table and are only ever read server-side; nothing below sends
 * rows across the sponsor boundary. The app starts EMPTY — a site lists itself
 * (upsertSite) and uploads its patients (replacePatients) before any of these
 * reads return data.
 */

import { prisma } from "@/lib/db";
import type { Patient } from "@/lib/matcher/types";

export interface SiteMeta {
  id: string;
  name: string;
  country: string;
  city: string;
  /** Brazilian macro-region (Norte/Nordeste/Centro-Oeste/Sudeste/Sul) — drives the regional breakdown. */
  region: string;
  persona: string;
  monthlyIncidence: number;
}

export interface SiteDataset {
  site: SiteMeta;
  patients: Patient[];
}

type SiteRow = {
  id: string;
  name: string;
  country: string;
  city: string;
  region: string;
  persona: string;
  monthlyIncidence: number;
};

function toMeta(row: SiteRow): SiteMeta {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    city: row.city,
    region: row.region,
    persona: row.persona,
    monthlyIncidence: row.monthlyIncidence,
  };
}

export async function loadSiteIds(): Promise<string[]> {
  const rows = await prisma.site.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  return rows.map((r) => r.id);
}

export async function loadSite(id: string): Promise<SiteDataset | null> {
  const site = await prisma.site.findUnique({ where: { id } });
  if (!site) return null;
  const patients = await prisma.patient.findMany({ where: { siteId: id } });
  return {
    site: toMeta(site),
    patients: patients.map((p) => JSON.parse(p.data) as Patient),
  };
}

export async function loadAllSites(): Promise<SiteDataset[]> {
  const sites = await prisma.site.findMany({ orderBy: { id: "asc" } });
  const datasets: SiteDataset[] = [];
  for (const site of sites) {
    const patients = await prisma.patient.findMany({ where: { siteId: site.id } });
    datasets.push({
      site: toMeta(site),
      patients: patients.map((p) => JSON.parse(p.data) as Patient),
    });
  }
  return datasets;
}

/** List (or update) a site. Called when a site registers itself. */
export async function upsertSite(meta: SiteMeta): Promise<void> {
  await prisma.site.upsert({
    where: { id: meta.id },
    create: { ...meta },
    update: { ...meta },
  });
}

/** Replace a site's patient records with `patients` (idempotent per site). */
export async function replacePatients(siteId: string, patients: Patient[]): Promise<void> {
  await prisma.$transaction([
    prisma.patient.deleteMany({ where: { siteId } }),
    ...patients.map((p) =>
      prisma.patient.create({
        data: { id: p.id, siteId, data: JSON.stringify({ ...p, siteId }) },
      }),
    ),
  ]);
}
