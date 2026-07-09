import { NextResponse } from "next/server";
import { fetchNationalEstimate, estimatorConfigured } from "@/lib/estimator/client";

export const dynamic = "force-dynamic";

/**
 * Proxy to the Python feasibility estimator. Lets the browser (and a plain curl)
 * read the national DataSUS estimate through the Next app. 503 when the estimator
 * service is unreachable.
 */
export async function GET() {
  const estimate = await fetchNationalEstimate();
  if (!estimate) {
    return NextResponse.json(
      {
        error: "estimator unreachable",
        estimator: estimatorConfigured().baseUrl,
        hint: "Start it: uvicorn api:app on port 8421 (see .claude/launch.json estimator-api).",
      },
      { status: 503 },
    );
  }
  return NextResponse.json(estimate);
}
