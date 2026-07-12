/**
 * US-1 — receive & parse. Turn a sponsor form (docx/text) into a FeasibilityRequest with parsed
 * FormFields + a template fingerprint, landing in the site's inbox. Reuses the ingestion layer;
 * the pure `buildRequestDraft` is unit-tested, `createFeasibilityRequest` persists it.
 */

import { prisma } from "@/lib/db";
import { extractDocumentText } from "@/lib/intake/envelope";
import { parseFormText, normalize } from "./ingest";
import { persistIntakeFields, type IntakeFieldInput } from "./persist";
import type { Archetype } from "./fixtures/questionBankLabels";

export interface RequestDraft {
  studyTitle: string;
  fingerprint: string;
  templateMatched: boolean;
  fields: IntakeFieldInput[];
}

/** Pure: extracted form text (+ optional filename) → a request draft. No I/O. */
export function buildRequestDraft(text: string, filename?: string): RequestDraft {
  const ingested = parseFormText(text);
  const fields: IntakeFieldInput[] = ingested.fields.map((f) => ({
    section: f.section,
    label: f.label,
    cellType: f.cellType,
    archetype: f.archetypeHint as Archetype,
    orderIdx: f.orderIdx,
  }));
  // Title: a "Título do estudo" line's tail if present, else the filename, else a default.
  const titleField = ingested.fields.find((f) => normalize(f.label).includes("titulo do estudo"));
  const fromFile = filename ? filename.replace(/\.[a-z0-9]+$/i, "").trim() : "";
  const studyTitle = fromFile || (titleField ? "Formulário de feasibility recebido" : "Formulário de feasibility");
  return { studyTitle, fingerprint: ingested.recognition.fingerprint, templateMatched: ingested.recognition.matched, fields };
}

/** Persist a received form as a FeasibilityRequest + its parsed fields (status "received"). */
export async function createFeasibilityRequest(input: {
  text: string;
  filename?: string;
  siteId: string;
  sponsorId?: string;
}): Promise<{ requestId: string; fieldCount: number }> {
  const draft = buildRequestDraft(input.text, input.filename);
  const request = await prisma.feasibilityRequest.create({
    data: {
      siteId: input.siteId,
      sponsorId: input.sponsorId ?? null,
      studyTitle: draft.studyTitle,
      templateId: draft.fingerprint,
      status: "received",
      criteria: "[]",
    },
  });
  await persistIntakeFields(request.id, input.siteId, draft.fields);
  return { requestId: request.id, fieldCount: draft.fields.length };
}

/** Extract text from an uploaded file (docx/pdf/text bytes). */
export function extractFormText(filename: string, bytes: Uint8Array): string {
  return extractDocumentText({ kind: "file", filename, bytes }).text;
}
