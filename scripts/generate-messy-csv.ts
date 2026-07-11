/**
 * Emit a realistic-but-MESSY CSV from the synthetic panel so the /site/new
 * mapping+verify step has something real to chew on: odd headers, mixed lab
 * units, a few blanks. Synthetic data → safe to commit at data/sample-ehr.csv.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePanel } from "./generate-data";

const HEADERS = ["MRN", "Dx", "Age (yrs)", "Sex", "Perf Status", "Stage", "HER-2 Status", "Prior Lines", "Creatinine (mg/dL)", "Hemoglobin (g/L)", "Platelets"];

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const panel = generatePanel();
const patients = panel[0].patients; // site-a
const lines = [HEADERS.join(",")];
patients.forEach((p, i) => {
  const hgb = p.labs.hemoglobin ? Math.round(p.labs.hemoglobin.value * 10) : ""; // g/dL → g/L to look messy
  const row = [
    p.id,
    i % 7 === 0 ? "" : "Breast cancer",               // scattered blank diagnosis
    p.age ?? "",
    p.sex === "female" ? "F" : p.sex === "male" ? "M" : "",
    p.ecog ?? "",
    p.stage ? `Stage ${p.stage}` : "",
    p.biomarkers.her2_status === "positive" ? "3+" : p.biomarkers.her2_status === "negative" ? "neg" : "",
    p.priorLines ?? "",
    p.labs.creatinine ? p.labs.creatinine.value : "",
    hgb,
    p.labs.platelets ? p.labs.platelets.value : "",
  ];
  lines.push(row.map(cell).join(","));
});
writeFileSync(resolve(process.cwd(), "data", "sample-ehr.csv"), lines.join("\n") + "\n");
console.log(`Wrote data/sample-ehr.csv (${patients.length} rows).`);
