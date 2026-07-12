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
export const maxDuration = 30;

/**
 * Raw upload/body cap. App-Router route handlers have NO default body-size
 * limit, and `formData()`/`arrayBuffer()` buffer the whole body in memory
 * before any adapter runs — so without this an unauthenticated multi-GB POST
 * would OOM the instance. (This is separate from the zip/pdf readers' 64MB
 * decompression-output cap.) Real protocol documents are well under this.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

class PayloadTooLarge extends Error {}

function assertWithinLimit(req: Request): void {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLarge(`upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }
}

async function buildInput(req: Request): Promise<IntakeInput> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new Error("no file field in the upload");
    // Defense-in-depth: Content-Length is a hint, so re-check the actual size.
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLarge(`file exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
    }
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
    assertWithinLimit(req);
    input = await buildInput(req);
  } catch (err) {
    const status = err instanceof PayloadTooLarge ? 413 : 400;
    return NextResponse.json({ error: (err as Error).message }, { status });
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
