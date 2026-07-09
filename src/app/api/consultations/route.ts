import { NextResponse } from "next/server";
import type { Criterion } from "@/lib/matcher/types";
import { loadConsultations, writeConsultations, loadResponses, writeResponses, StoredConsultation, StoredResponse } from "@/lib/store";
import { loadAllSites } from "@/lib/data/sites";
import { evaluateCohort, countCohorts } from "@/lib/matcher/engine";
import { rankBottlenecks } from "@/lib/matcher/soften";

export const dynamic = "force-dynamic";

interface PostBody {
  title?: string;
  sponsorName?: string;
  nct?: string;
  protocolText?: string;
  criteria?: Criterion[];
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

  const consultation: StoredConsultation = {
    id: slugId(body.title),
    sponsorName: body.sponsorName || "Marcus / Meridian Oncology (composite persona)",
    title: body.title,
    nct: body.nct,
    protocolText: body.protocolText ?? "",
    criteria,
    heroBottleneckHandle: body.heroBottleneckHandle,
    createdAt: new Date().toISOString(),
  };
  const existing = await loadConsultations();
  await writeConsultations([...existing.filter((c) => c.id !== consultation.id), consultation]);

  // Auto-compute all responding sites so the posted consultation has a working
  // aggregate + softening view immediately (counts-not-rows).
  const newResponses: StoredResponse[] = [];
  for (const ds of await loadAllSites()) {
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
  const allResponses = await loadResponses();
  const others = allResponses.filter((r) => r.consultationId !== consultation.id);
  await writeResponses([...others, ...newResponses]);

  return NextResponse.json({ id: consultation.id });
}
