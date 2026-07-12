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
import type { CompiledProtocol } from "@/lib/estimator/protocol";
import type { NationalEstimate } from "@/lib/estimator/client";
export type EstimateStatus = "pending"|"running"|"complete"|"partial"|"failed";
export type ReportPipelineKey = "first-party-supply" | "regulatory" | "competitive-intensity" | "site-kol-discovery" | "standard-of-care" | "representativeness" | "eligibility-realism";
export type ReportPipelineStatus = "queued" | "running" | "complete" | "partial" | "failed";
export interface ReportPipelineProgress {
  key: ReportPipelineKey;
  status: ReportPipelineStatus;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  result?: unknown;
  citations?: Array<{ url: string; title: string }>;
  error?: string;
}
export interface StoredReportRun {
  schemaVersion: "report-run.v1";
  runId: string;
  consultationId: string;
  status: "queued" | "running" | "ready" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
  pipelines: ReportPipelineProgress[];
}

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
  estimateStatus?: EstimateStatus;
  estimateProtocol?: CompiledProtocol;
  estimateResult?: NationalEstimate;
  estimateError?: string;
  estimatedAt?: string;
  reportRun?: StoredReportRun;
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
  estimateStatus:string; estimateProtocol:string|null; estimateResult:string|null; estimateError:string|null; estimatedAt:Date|null; reportRun:string|null;
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
    estimateStatus:row.estimateStatus as EstimateStatus,
    estimateProtocol:row.estimateProtocol?JSON.parse(row.estimateProtocol):undefined,
    estimateResult:row.estimateResult?JSON.parse(row.estimateResult):undefined,
    estimateError:row.estimateError??undefined, estimatedAt:row.estimatedAt?.toISOString(),
    reportRun:row.reportRun?JSON.parse(row.reportRun) as StoredReportRun:undefined,
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
      estimateStatus:c.estimateStatus??"pending", estimateProtocol:c.estimateProtocol?JSON.stringify(c.estimateProtocol):null,
      estimateResult:c.estimateResult?JSON.stringify(c.estimateResult):null, estimateError:c.estimateError??null,
      estimatedAt:c.estimatedAt?new Date(c.estimatedAt):null,
      reportRun:c.reportRun?JSON.stringify(c.reportRun):null,
    };
    await prisma.consultation.upsert({
      where: { id: c.id },
      create: { id: c.id, ...data },
      update: data,
    });
  }
}

export async function updateConsultationEstimate(id:string, patch:Pick<StoredConsultation,"estimateStatus"|"estimateProtocol"|"estimateResult"|"estimateError"|"estimatedAt"> & {clearResult?:boolean}):Promise<void>{
  await prisma.consultation.update({where:{id},data:{estimateStatus:patch.estimateStatus,estimateProtocol:patch.estimateProtocol?JSON.stringify(patch.estimateProtocol):undefined,estimateResult:patch.clearResult?null:patch.estimateResult?JSON.stringify(patch.estimateResult):undefined,estimateError:patch.estimateError??null,estimatedAt:patch.clearResult?null:patch.estimatedAt?new Date(patch.estimatedAt):undefined}});
}

export async function updateConsultationReportRun(id:string, reportRun:StoredReportRun):Promise<void>{
  await prisma.consultation.update({where:{id},data:{reportRun:JSON.stringify(reportRun)}});
}

export async function updateReportPipeline(
  id:string,
  key:ReportPipelineKey,
  patch:Partial<ReportPipelineProgress>,
):Promise<StoredReportRun>{
  return prisma.$transaction(async(tx)=>{
    const row=await tx.consultation.findUnique({where:{id},select:{reportRun:true}});
    if(!row) throw new Error(`Unknown consultation ${id}`);
    const now=new Date().toISOString();
    const run=(row.reportRun?JSON.parse(row.reportRun):newReportRun(id,now)) as StoredReportRun;
    run.pipelines=run.pipelines.map((pipeline)=>pipeline.key===key?{...pipeline,...patch,key}:pipeline);
    const terminal=run.pipelines.every((pipeline)=>["complete","partial","failed"].includes(pipeline.status));
    const completed=run.pipelines.filter((pipeline)=>pipeline.status==="complete").length;
    run.status=terminal?(completed===run.pipelines.length?"ready":completed>0?"partial":"failed"):"running";
    run.updatedAt=now;
    await tx.consultation.update({where:{id},data:{reportRun:JSON.stringify(run)}});
    return run;
  });
}

export function newReportRun(consultationId:string,now=new Date().toISOString()):StoredReportRun{
  const keys:ReportPipelineKey[]=["first-party-supply","regulatory","competitive-intensity","site-kol-discovery","standard-of-care","representativeness","eligibility-realism"];
  return {schemaVersion:"report-run.v1",runId:`report-${consultationId}`,consultationId,status:"queued",createdAt:now,updatedAt:now,pipelines:keys.map((key)=>({key,status:"queued"}))};
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
