import { NextResponse } from "next/server";
import { parseCriteria } from "@/lib/parse";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "empty protocol text" }, { status: 400 });
  }
  const result = await parseCriteria(text);
  return NextResponse.json(result);
}
