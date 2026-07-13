import { NextResponse } from "next/server";
import type { Criterion } from "@/lib/matcher/types";
import { buildElasticsearchPlan } from "@/lib/elasticsearch/plan";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { criteria?: Criterion[] };
  if (!Array.isArray(body.criteria) || body.criteria.length === 0) {
    return NextResponse.json({ error: "non-empty reviewed criteria required" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildElasticsearchPlan(body.criteria));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 422 });
  }
}
