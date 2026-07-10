/**
 * XLSX eligibility-matrix adapter — Phase 4 long tail.
 *
 * Some sponsors keep eligibility as a spreadsheet: one row per criterion, with
 * columns like kind | field | operator | value | unit. This adapter reuses the
 * zip envelope to read the first worksheet. If the header looks like a
 * structured criteria matrix, each row maps directly to a typed Criterion
 * (preParsedCriteria — the structured lane). Otherwise the whole sheet is
 * flattened to text and funneled through parse.ts (eligibilityText lane).
 *
 * Dependency-free: parses the SpreadsheetML we need (shared + inline strings,
 * numbers) by hand — not a general XLSX library.
 */

import type { Criterion, Operator } from "@/lib/matcher/types";
import { unzip } from "../envelope";
import { locateEligibilityHeuristic } from "../locateEligibility";
import type { IntakeInput, IntakeResult, SourceAdapter } from "../types";

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, "&");
}

/** Column letters (e.g. "AB") → 0-based index. */
function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Read the first worksheet as a grid of trimmed cell strings. */
export function xlsxRows(bytes: Uint8Array): string[][] {
  const map = unzip(bytes);
  const sheetName = [...map.keys()].find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n)) ??
    [...map.keys()].find((n) => /^xl\/worksheets\/.*\.xml$/i.test(n));
  if (!sheetName) throw new Error("xlsx: no worksheet found");
  const sheet = utf8(map.get(sheetName)!);

  const sharedXml = map.get("xl/sharedStrings.xml");
  const shared = sharedXml
    ? [...utf8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(""),
      )
    : [];

  const rows: string[][] = [];
  for (const rowM of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cM of rowM[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cM[1];
      const inner = cM[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] ?? "A1";
      const type = attrs.match(/t="([^"]+)"/)?.[1];
      let value = "";
      if (type === "s") {
        const idx = Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "-1");
        value = shared[idx] ?? "";
      } else if (type === "inlineStr") {
        value = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join("");
      } else {
        value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
      }
      cells[colIndex(ref)] = value.trim();
    }
    rows.push(Array.from(cells, (c) => c ?? ""));
  }
  return rows;
}

const OP_SYNONYMS: Record<string, Operator> = {
  "<": "lt", "<=": "lte", ">": "gt", ">=": "gte", "=": "eq", "==": "eq", "!=": "neq",
  lt: "lt", lte: "lte", gt: "gt", gte: "gte", eq: "eq", neq: "neq",
  in: "in", not_in: "not_in", exists: "exists", not_exists: "not_exists", between: "between",
};

function toValue(op: Operator, raw: string): Criterion["value"] {
  if (op === "exists" || op === "not_exists") return null;
  if (op === "between" || op === "in" || op === "not_in") {
    return raw.split(/[,;|]/).map((p) => {
      const t = p.trim();
      const n = Number(t);
      return t !== "" && !Number.isNaN(n) ? n : t;
    });
  }
  const n = Number(raw);
  return raw !== "" && !Number.isNaN(n) ? n : raw;
}

/** Header → column map when the sheet is a structured criteria matrix. */
function headerMap(header: string[]): Record<string, number> | null {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const k = h.toLowerCase().trim();
    if (/^(kind|type)$/.test(k)) idx.kind = i;
    else if (/^field$/.test(k)) idx.field = i;
    else if (/^(operator|op)$/.test(k)) idx.operator = i;
    else if (/^value$/.test(k)) idx.value = i;
    else if (/^unit$/.test(k)) idx.unit = i;
    else if (/^(raw|raw ?text|text|criterion)$/.test(k)) idx.rawText = i;
  });
  return idx.field !== undefined && idx.operator !== undefined ? idx : null;
}

export const xlsxAdapter: SourceAdapter = {
  id: "xlsx",

  detect(input) {
    if (input.kind !== "file") return 0;
    try {
      return unzip(input.bytes).has("xl/workbook.xml") ? 0.7 : 0;
    } catch {
      return 0;
    }
  },

  async extract(input): Promise<IntakeResult> {
    if (input.kind !== "file") throw new Error("xlsx adapter: expects a file input");
    const rows = xlsxRows(input.bytes).filter((r) => r.some((c) => c !== ""));
    if (rows.length === 0) throw new Error("xlsx adapter: empty spreadsheet");

    const meta = { sourceId: input.filename, sourceRegistry: "xlsx", title: input.filename };
    const hmap = headerMap(rows[0]);

    if (hmap) {
      const criteria: Criterion[] = rows.slice(1).map((row, i) => {
        const kindRaw = (hmap.kind !== undefined ? row[hmap.kind] : "").toLowerCase();
        const op = OP_SYNONYMS[(row[hmap.operator] ?? "").toLowerCase().trim()] ?? "eq";
        const field = row[hmap.field] ?? "";
        return {
          id: `c${i + 1}`,
          kind: kindRaw.startsWith("excl") ? "exclusion" : "inclusion",
          field: field.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
          operator: op,
          value: toValue(op, hmap.value !== undefined ? row[hmap.value] ?? "" : ""),
          unit: hmap.unit !== undefined && row[hmap.unit] ? row[hmap.unit] : undefined,
          rawText: hmap.rawText !== undefined && row[hmap.rawText] ? row[hmap.rawText] : `${field} ${op} ${hmap.value !== undefined ? row[hmap.value] : ""}`.trim(),
          confidence: 0.8, // human-authored matrix — trustworthy but verify
        };
      });
      return {
        metadata: meta,
        preParsedCriteria: criteria,
        provenance: { adapter: "xlsx", extraction: "structured", trust: "medium", note: `Mapped ${criteria.length} rows from an eligibility matrix.` },
      };
    }

    // Not a structured matrix — flatten and funnel through parse.ts.
    const text = rows.map((r) => r.join("\t")).join("\n");
    const located = locateEligibilityHeuristic(text);
    return {
      metadata: meta,
      eligibilityText: located.text,
      provenance: { adapter: "xlsx", extraction: "text", trust: "low", note: `Flattened spreadsheet text. ${located.note}` },
    };
  },
};
