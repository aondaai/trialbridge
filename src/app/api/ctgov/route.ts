import { NextResponse } from "next/server";
import { fetchProtocol } from "@/lib/ctgov";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { nctId?: string };
  const nctId = (body.nctId ?? "").trim();
  if (!nctId) {
    return NextResponse.json({ error: "nctId is required" }, { status: 400 });
  }
  try {
    const result = await fetchProtocol(nctId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
