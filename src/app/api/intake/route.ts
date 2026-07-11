/**
 * POST /api/intake — the universal front door.
 *
 * Accepts any sponsor input and runs it through the SourceAdapter registry
 * (src/lib/intake). Two content types:
 *   • multipart/form-data with a `file` field  → { kind: "file", … }  (PDF/DOCX/XLSX/eCTD)
 *   • application/json { mode, id?|text?|data? } → id / text / json input
 *
 * Returns the `IntakeResult`: { metadata, eligibilityText?, preParsedCriteria?, provenance }.
 * The client routes on the lane — eligibilityText → the parse+verify flow;
 * preParsedCriteria → straight to the verify table.
 */

import { NextResponse } from "next/server";
import { defaultRegistry } from "@/lib/intake";
import type { IntakeInput } from "@/lib/intake";

export const dynamic = "force-dynamic";
// Uploaded documents can be a few MB; allow a generous body (the zip reader caps
// decompression at 64MB per entry regardless).
export const maxDuration = 30;

async function buildInput(req: Request): Promise<IntakeInput> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new Error("no file field in the upload");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) throw new Error("uploaded file is empty");
    return { kind: "file", filename: file.name || "upload", bytes };
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    id?: string;
    text?: string;
    data?: unknown;
  };
  switch (body.mode) {
    case "id":
      if (!body.id?.trim()) throw new Error("registry id is required");
      return { kind: "id", id: body.id.trim() };
    case "text":
      if (!body.text?.trim()) throw new Error("protocol text is required");
      return { kind: "text", text: body.text };
    case "json": {
      const data = typeof body.data === "string" ? JSON.parse(body.data) : body.data;
      if (!data || typeof data !== "object") throw new Error("structured input must be a JSON object");
      return { kind: "json", data };
    }
    default:
      throw new Error(`unknown intake mode "${body.mode}" (expected id | text | json | a file upload)`);
  }
}

export async function POST(req: Request) {
  let input: IntakeInput;
  try {
    input = await buildInput(req);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const result = await defaultRegistry().ingest(input);
    return NextResponse.json(result);
  } catch (err) {
    // Malformed documents / unrecognized formats / unknown registry ids all
    // surface here as clean 422s (the adapters throw descriptive messages).
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
