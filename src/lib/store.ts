/**
 * The consultations & responses store — the marketplace layer.
 *
 * Persistence is a committed JSON snapshot (data/consultations.json,
 * data/responses.json). This is deliberately lightweight (the spec calls for a
 * "single in-memory / lightweight-DB consultations list", not real marketplace
 * infra) and it makes the frozen demo snapshot a plain committed file — nothing
 * on the demo path needs a query engine or network. The Prisma/SQLite schema in
 * prisma/schema.prisma is the documented post-hackathon swap target (ADR
 * Decision 2: datasource is swappable).
 *
 * PRIVACY BY CONSTRUCTION: a `StoredResponse` carries COUNTS and a bottleneck
 * reference — never patient rows. A sponsor reading responses physically cannot
 * reach row-level patient data because it was never written here. Patient rows
 * live only in the per-site data/*.json (the site's own origin).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
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
  /** true when submitted live in the UI (Camila's site), false for pre-seeded. */
  live: boolean;
  submittedAt: string;
}

function dataDir(): string {
  return resolve(process.cwd(), "data");
}

function consultationsPath(): string {
  return resolve(dataDir(), "consultations.json");
}

function responsesPath(): string {
  return resolve(dataDir(), "responses.json");
}

export function loadConsultations(): StoredConsultation[] {
  const p = consultationsPath();
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as StoredConsultation[];
}

export function getConsultation(id: string): StoredConsultation | undefined {
  return loadConsultations().find((c) => c.id === id);
}

export function writeConsultations(list: StoredConsultation[]): void {
  writeFileSync(consultationsPath(), JSON.stringify(list, null, 2) + "\n");
}

export function loadResponses(consultationId?: string): StoredResponse[] {
  const p = responsesPath();
  if (!existsSync(p)) return [];
  const all = JSON.parse(readFileSync(p, "utf8")) as StoredResponse[];
  return consultationId ? all.filter((r) => r.consultationId === consultationId) : all;
}

export function writeResponses(list: StoredResponse[]): void {
  writeFileSync(responsesPath(), JSON.stringify(list, null, 2) + "\n");
}

export function hasResponded(consultationId: string, siteId: string): boolean {
  return loadResponses(consultationId).some((r) => r.siteId === siteId);
}

/**
 * Insert or replace a site's response to a consultation (idempotent per site).
 * This is the write path used by the live "submit capacity" action.
 */
export function upsertResponse(resp: StoredResponse): StoredResponse[] {
  const all = loadResponses();
  const filtered = all.filter(
    (r) => !(r.consultationId === resp.consultationId && r.siteId === resp.siteId),
  );
  filtered.push(resp);
  writeResponses(filtered);
  return filtered.filter((r) => r.consultationId === resp.consultationId);
}
