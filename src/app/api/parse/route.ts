import { NextResponse } from "next/server";
import { parseCriteria } from "@/lib/parse";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string; nctId?: string };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty protocol text" }, { status: 400 });
  }
  try {
    const result = await parseCriteria(text, body.nctId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
