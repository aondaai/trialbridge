import { NextResponse } from "next/server";
import type { Criterion } from "@/lib/matcher/types";
import { writeConsultations, upsertResponse, StoredConsultation, StoredResponse, newReportRun } from "@/lib/store";
import { loadAllSites } from "@/lib/data/sites";
import { evaluateCohort, countCohorts } from "@/lib/matcher/engine";
import { rankBottlenecks } from "@/lib/matcher/soften";
import { compileEstimatorProtocol } from "@/lib/estimator/protocol";
import type { ElasticsearchQueryPlan } from "@/lib/elasticsearch/types";
import { validateElasticsearchPlan } from "@/lib/elasticsearch/validate";
import { syncCmaEstimate } from "@/lib/estimator/cma-run";

export const dynamic = "force-dynamic";

interface PostBody {
  title?: string;
  sponsorName?: string;
  nct?: string;
  protocolText?: string;
  criteria?: Criterion[];
  elasticsearchPlan?: ElasticsearchQueryPlan;
  heroBottleneckHandle?: string;
}

function slugId(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "consultation";
  return `${base}-${Date.now().toString(36)}`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const criteria = body.criteria ?? [];
  if (!body.title || criteria.length === 0) {
    return NextResponse.json({ error: "title and non-empty criteria required" }, { status: 400 });
  }
  if (!body.elasticsearchPlan) {
    return NextResponse.json({ error: "reviewed Elasticsearch plan required" }, { status: 400 });
  }
  if (body.elasticsearchPlan) {
    try {
      validateElasticsearchPlan(body.elasticsearchPlan);
      if (!body.elasticsearchPlan.reviewedAt) throw new Error("Elasticsearch plan must be explicitly reviewed before posting");
      const criteriaIds = new Set(criteria.map((criterion) => criterion.id));
      const stageIds = new Set(body.elasticsearchPlan.stages.map((stage) => stage.criterionId));
      if (body.elasticsearchPlan.stages.length !== criteria.length || criteriaIds.size !== stageIds.size || [...criteriaIds].some((id) => !stageIds.has(id))) {
        throw new Error("Elasticsearch plan must contain exactly one stage per reviewed criterion");
      }
      const kindById = new Map(criteria.map((criterion) => [criterion.id, criterion.kind]));
      for (const stage of body.elasticsearchPlan.stages) {
        const expected = kindById.get(stage.criterionId) === "exclusion" ? "EXCLUSION" : "INCLUSION";
        if (stage.stageType !== expected) throw new Error(`Stage type does not match criterion ${stage.criterionId}`);
      }
    } catch (error) {
      return NextResponse.json({ error: `invalid Elasticsearch plan: ${(error as Error).message}` }, { status: 400 });
    }
  }

  const id=slugId(body.title);
  const consultation: StoredConsultation = {
    id,
    sponsorName: body.sponsorName || "Marcus / Meridian Oncology (composite persona)",
    title: body.title,
    nct: body.nct,
    protocolText: body.protocolText ?? "",
    criteria,
    elasticsearchPlan: body.elasticsearchPlan,
    heroBottleneckHandle: body.heroBottleneckHandle,
    createdAt: new Date().toISOString(),
    estimateStatus:"pending", estimateProtocol:compileEstimatorProtocol(id,criteria),
    reportRun:newReportRun(id),
  };
  // This id is new. Persist only this consultation so a concurrent estimator or
  // report update on an existing consultation can never be overwritten by a
  // stale load-all/write-all snapshot.
  await writeConsultations([consultation]);

  // Start the durable MCA/CMA job as part of the post transaction. Previously
  // the job was only started by ReportGenerator after the browser had
  // navigated and hydrated, so closing the tab (or a client-side error) left a
  // freshly posted consultation queued forever.
  let cma: Awaited<ReturnType<typeof syncCmaEstimate>>;
  try {
    cma = await syncCmaEstimate(consultation);
  } catch (error) {
    cma = {
      status: "failed",
      stage: "failed",
      error: error instanceof Error ? error.message : "MCA job could not be started",
    };
  }

  // Auto-compute all responding sites so the posted consultation has a working
  // aggregate + softening view immediately (counts-not-rows).
  const newResponses: StoredResponse[] = [];
  const seedDemo=process.env.TB_SEED_DEMO_RESPONSES==="true"||process.env.NODE_ENV!=="production";
  for (const ds of seedDemo?await loadAllSites():[]) {
    const evals = evaluateCohort(ds.patients, criteria);
    const counts = countCohorts(evals);
    const top = rankBottlenecks(ds.patients, criteria)[0];
    newResponses.push({
      id: `resp-${consultation.id}-${ds.site.id}`,
      consultationId: consultation.id,
      siteId: ds.site.id,
      siteName: ds.site.name,
      definite: counts.definite,
      possible: counts.possible,
      excluded: counts.excluded,
      total: counts.total,
      bottleneckHandle: top?.handle ?? null,
      bottleneckLabel: top?.label ?? null,
      monthlyIncidence: ds.site.monthlyIncidence,
      live: false,
      submittedAt: new Date().toISOString(),
    });
  }
  // The consultation id is new, so only insert its own rows. Never rewrite the
  // shared response table: sites may be submitting responses concurrently.
  for (const response of newResponses) await upsertResponse(response);

  return NextResponse.json({ id: consultation.id, cma }, { status: 201 });
}
