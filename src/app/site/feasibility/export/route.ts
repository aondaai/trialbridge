/**
 * US-5 export endpoint — GET /site/feasibility/export?req=<id> → a filled .docx of the request's
 * APPROVED answers (via the diff-guarded builder; nothing unapproved ships). Aggregate-only: the
 * exported values are the reviewed field answers, never patient rows.
 */

import { prisma } from "@/lib/db";
import { loadRenderAnswers } from "@/lib/feasibility-autofill/persist";
import { buildExportDocx } from "@/lib/feasibility-autofill/render/exportDocx";
import type { AnswerRecord } from "@/lib/feasibility-autofill/render/diff";

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("req");
  if (!id) return new Response("missing ?req", { status: 400 });

  const request = await prisma.feasibilityRequest.findUnique({ where: { id } });
  if (!request) return new Response("unknown request", { status: 404 });

  const answers = await loadRenderAnswers(id);
  const records: AnswerRecord[] = answers.map((a) => ({
    fieldId: a.fieldId,
    label: a.label,
    value: a.metric.value == null ? "" : String(a.metric.value),
    status: a.status as AnswerRecord["status"],
  }));

  const { bytes, approvedCount } = buildExportDocx(request.studyTitle, records);
  const safeName = request.studyTitle.replace(/[^\w.-]+/g, "_").slice(0, 60) || "feasibility";
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safeName}.docx"`,
      "x-approved-count": String(approvedCount),
    },
  });
}
