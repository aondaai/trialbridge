/**
 * US-1 intake endpoint — POST a sponsor feasibility form (multipart file, or JSON {text}) →
 * creates a FeasibilityRequest with parsed FormFields, landing in the site's inbox.
 * Aggregate-only downstream; this step touches no patient data.
 */

import { NextResponse } from "next/server";
import { createFeasibilityRequest, extractFormText } from "@/lib/feasibility-autofill/intakeRequest";

const DEMO_SITE_ID = "site-ihealth-demo";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctype = req.headers.get("content-type") ?? "";
    let text = "";
    let filename: string | undefined;
    let siteId = DEMO_SITE_ID;
    let sponsorId: string | undefined;

    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      siteId = String(form.get("siteId") || DEMO_SITE_ID);
      sponsorId = form.get("sponsorId") ? String(form.get("sponsorId")) : undefined;
      if (file && typeof file !== "string") {
        filename = file.name;
        text = extractFormText(file.name, new Uint8Array(await file.arrayBuffer()));
      } else {
        text = String(form.get("text") || "");
      }
    } else {
      const body = (await req.json()) as { text?: string; filename?: string; siteId?: string; sponsorId?: string };
      text = body.text ?? "";
      filename = body.filename;
      siteId = body.siteId ?? DEMO_SITE_ID;
      sponsorId = body.sponsorId;
    }

    if (!text.trim()) return NextResponse.json({ error: "empty form: no text extracted" }, { status: 400 });

    const { requestId, fieldCount } = await createFeasibilityRequest({ text, filename, siteId, sponsorId });
    return NextResponse.json({ requestId, fieldCount });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
