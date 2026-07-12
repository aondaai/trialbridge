/**
 * US-5 export — render a request's APPROVED answers back into a filled .docx. Only approved
 * answers ship: the template is built from the approved set and filled via the render diff guard,
 * so a proposed/edited/rejected answer (and every D draft that wasn't signed off) can never leak
 * into the exported document. Pure (records in → bytes out) so it's unit-testable.
 */

import { makeDocx, fillDocxTemplate, escapeXml } from "./docx";
import { buildRenderDiff, approvedRenderValues, type AnswerRecord } from "./diff";

export interface ExportResult {
  bytes: Uint8Array;
  approvedCount: number;
  withheldCount: number;
}

/** Build a filled .docx containing only the approved answers for a study. */
export function buildExportDocx(studyTitle: string, records: AnswerRecord[]): ExportResult {
  const diff = buildRenderDiff(records);
  const values = approvedRenderValues(records); // { fieldId → value } for approved only

  const body = [
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(studyTitle)}</w:t></w:r></w:p>`,
    ...diff.approved.map(
      (a) => `<w:p><w:r><w:t>${escapeXml(a.label)}: {{${a.fieldId}}}</w:t></w:r></w:p>`,
    ),
  ].join("");

  const bytes = fillDocxTemplate(makeDocx(body), values);
  return { bytes, approvedCount: diff.approved.length, withheldCount: diff.withheld.length };
}
