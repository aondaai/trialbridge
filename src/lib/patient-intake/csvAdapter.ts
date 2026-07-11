/**
 * The demo PatientSourceAdapter: CSV text or an .xlsx upload → Patient[].
 * Row 1 = headers. Each header gets a target (heuristic or override); each cell
 * is normalized into its slot (scalar field / biomarkers / labs). Anything
 * unparseable → null (→ unknown) and is counted, never dropped silently.
 */
import type { Patient } from "@/lib/matcher/types";
import { xlsxRows } from "@/lib/intake/adapters/xlsx";
import { parseCsv } from "./csv";
import { suggestTarget, unitFromHeader } from "./headerMap";
import { normalizeInt, normalizeSex, normalizeMarker, normalizeStage, parseLab, slugColumn } from "./normalize";
import type {
  ColumnMapping, IntakeStats, LabField, MapTarget, PatientIntakeResult, PatientSourceAdapter, PatientSourceInput, TrustTier,
} from "./types";

const LAB_FIELDS: LabField[] = ["creatinine", "hemoglobin", "platelets", "bilirubin", "ejection_fraction"];

function isCsvFile(input: PatientSourceInput): boolean {
  if (input.kind === "text") return true;
  return /\.(csv|xlsx)$/i.test(input.filename) ||
    (input.bytes.length >= 2 && input.bytes[0] === 0x50 && input.bytes[1] === 0x4b); // PK → xlsx zip
}

function rowsFrom(input: PatientSourceInput): { rows: string[][]; extraction: "csv" | "xlsx" } {
  if (input.kind === "text") return { rows: parseCsv(input.text), extraction: "csv" };
  const isXlsx = input.bytes[0] === 0x50 && input.bytes[1] === 0x4b;
  return isXlsx
    ? { rows: xlsxRows(input.bytes), extraction: "xlsx" }
    : { rows: parseCsv(new TextDecoder("utf-8").decode(input.bytes)), extraction: "csv" };
}

/** Assign one normalized cell into the patient, returning true if it was usable. */
function assign(p: Patient, target: MapTarget, header: string, raw: string): boolean {
  const t = raw.trim();
  switch (target) {
    case "ignore": return true; // not "unparsed" — deliberately skipped
    case "id": { if (t) { p.id = t; return true; } return false; }
    case "diagnosis": { if (t) { p.diagnosis = t; return true; } return false; }
    case "stage": { const v = normalizeStage(t); p.stage = v; return v !== null; }
    case "sex": { const v = normalizeSex(t); p.sex = v; return v !== null; }
    case "age": { const v = normalizeInt(t, 0, 120); p.age = v; return v !== null; }
    case "ecog": { const v = normalizeInt(t, 0, 4); p.ecog = v; return v !== null; }
    case "priorLines": { const v = normalizeInt(t, 0, 99); p.priorLines = v; return v !== null; }
    case "her2_status": case "er_status": case "pr_status": {
      const v = normalizeMarker(t); p.biomarkers[target] = v; return v !== null;
    }
    case "creatinine": case "hemoglobin": case "platelets": case "bilirubin": case "ejection_fraction": {
      const v = parseLab(target as LabField, t, unitFromHeader(header)); p.labs[target] = v; return v !== null;
    }
    case "biomarker": {
      const key = slugColumn(header);
      const v = t === "" ? null : t;
      p.biomarkers[key] = v; return v !== null;
    }
  }
}

function trustFor(stats: IntakeStats, columns: number): TrustTier {
  const totalCells = stats.rows * Math.max(1, columns - stats.columnsIgnored);
  const unparsedFrac = totalCells === 0 ? 0 : stats.cellsUnparsed / totalCells;
  if (stats.columnsMapped >= columns - stats.columnsIgnored && unparsedFrac < 0.05) return "high";
  if (unparsedFrac < 0.25) return "medium";
  return "low";
}

export const csvAdapter: PatientSourceAdapter = {
  id: "csv",
  detect: (input) => (isCsvFile(input) ? 1 : 0),

  async extract(input, override): Promise<PatientIntakeResult> {
    const { rows, extraction } = rowsFrom(input);
    if (rows.length < 2) throw new Error("csv: need a header row and at least one data row");
    const headers = rows[0].map((h) => h.trim());
    const targets: MapTarget[] = headers.map((h) => override?.[h] ?? suggestTarget(h));

    const stats: IntakeStats = { rows: rows.length - 1, columnsMapped: 0, columnsIgnored: 0, cellsUnparsed: 0 };
    targets.forEach((t) => { if (t === "ignore") stats.columnsIgnored++; else stats.columnsMapped++; });

    const patients: Patient[] = rows.slice(1).map((cells, ri) => {
      const p: Patient = { id: `row-${ri + 1}`, siteId: "", diagnosis: "", stage: null, biomarkers: {}, priorLines: null, ecog: null, labs: {}, sex: null, age: null };
      headers.forEach((h, ci) => {
        const target = targets[ci];
        if (target === "ignore") return;
        const raw = cells[ci] ?? "";
        const usable = assign(p, target, h, raw);
        if (!usable) stats.cellsUnparsed++;
      });
      return p;
    });

    const mapping: ColumnMapping[] = headers.map((h, ci) => ({
      column: h, target: targets[ci], samples: rows.slice(1, 4).map((r) => (r[ci] ?? "").trim()).filter(Boolean),
    }));

    const trust = trustFor(stats, headers.length);
    return {
      patients, mapping, stats,
      provenance: {
        adapter: "csv", extraction, trust,
        note: `${stats.rows} rows · ${stats.columnsMapped} columns mapped · ${stats.columnsIgnored} ignored · ${stats.cellsUnparsed} cells left unknown.`,
      },
    };
  },
};
