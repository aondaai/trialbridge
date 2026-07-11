/**
 * POST /api/patient-intake — structure a CSV/XLSX EHR export into Patient[].
 * multipart/form-data { file } OR application/json { mode:"text", text, override? }.
 * Runs entirely on the site's own server; patient rows are returned to the
 * site's own browser only (never to the sponsor, never to an LLM).
 */
import { NextResponse } from "next/server";
import { defaultPatientRegistry } from "@/lib/patient-intake";
import type { MapTarget, PatientSourceInput } from "@/lib/patient-intake";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
class PayloadTooLarge extends Error {}

export async function POST(req: Request) {
  let input: PatientSourceInput;
  let override: Record<string, MapTarget> | undefined;
  try {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(len) && len > MAX_UPLOAD_BYTES) throw new PayloadTooLarge("upload exceeds 25MB limit");
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") throw new Error("no file field in the upload");
      if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLarge("file exceeds 25MB limit");
      input = { kind: "file", filename: file.name || "upload.csv", bytes: new Uint8Array(await file.arrayBuffer()) };
      const ov = form.get("override");
      if (typeof ov === "string" && ov) override = JSON.parse(ov);
    } else {
      const body = (await req.json().catch(() => ({}))) as { mode?: string; text?: string; override?: Record<string, MapTarget> };
      if (body.mode !== "text" || !body.text?.trim()) throw new Error("expected { mode:'text', text } or a file upload");
      input = { kind: "text", text: body.text };
      override = body.override;
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: err instanceof PayloadTooLarge ? 413 : 400 });
  }
  try {
    return NextResponse.json(await defaultPatientRegistry().structure(input, override));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
