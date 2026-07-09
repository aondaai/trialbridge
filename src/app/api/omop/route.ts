import { NextResponse } from "next/server";
import { toOmopCriteria } from "@/lib/omop/transform";
import type { Criterion } from "@/lib/matcher/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { criteria?: Criterion[] };
  const criteria = body.criteria ?? [];
  if (!Array.isArray(criteria) || criteria.length === 0) {
    return NextResponse.json({ error: "criteria array is required" }, { status: 400 });
  }
  const omopCriteria = toOmopCriteria(criteria);
  return NextResponse.json({ omopCriteria });
}
