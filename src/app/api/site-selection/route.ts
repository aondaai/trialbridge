import { NextResponse } from "next/server";
import { getConsultation } from "@/lib/store";
import { runSiteShortlist } from "@/lib/feasibility-autofill/mcp/siteShortlistTool";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expectedToken = process.env.TB_SITE_SELECTION_TOKEN?.trim();
  if (expectedToken) {
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (supplied !== expectedToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json() as { consultationId?: unknown; limit?: unknown };
    const result = await runSiteShortlist(
      {
        consultationId: typeof body.consultationId === "string" ? body.consultationId : "",
        limit: body.limit === undefined ? undefined : Number(body.limit),
      },
      async (id) => await getConsultation(id),
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "site selection failed" }, { status: 400 });
  }
}
