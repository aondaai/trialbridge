/**
 * Real Brazilian research-site directory — parsed from the ABRACRO and ACESSE
 * association spreadsheets. This is the site-side registry TrialBridge's marketplace
 * thesis needs: real centres with CNES codes, therapeutic-area coverage, inspection
 * experience (ANVISA/FDA/EMA), and contacts — a huge step up from 3 synthetic sites.
 *
 * Pure parsing/normalization (no I/O); the import script feeds it `xlsxRows` output.
 */

export type Macroregion = "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul";
export type DirectorySource = "abracro" | "acesse";

export interface DirectorySite {
  id: string; // stable slug (cnes if present, else normalized name)
  name: string; // institution/hospital
  cnes: string | null;
  cnpj: string | null;
  city: string | null;
  uf: string | null; // 2-letter state code
  region: Macroregion | null;
  therapeuticAreas: string[]; // e.g. ["Oncologia", "Vacinas"]
  oncology: boolean;
  cepName: string | null; // ethics committee
  inspections: { anvisa: boolean; fda: boolean; ema: boolean; any: boolean };
  edcExperience: boolean;
  rbmExperience: boolean;
  centralLabExams: boolean;
  centralLabImaging: boolean;
  piCount: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  sources: DirectorySource[];
}

// ── Geography ────────────────────────────────────────────────────────────────────
const UF_REGION: Record<string, Macroregion> = {
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};
export function ufToRegion(uf: string | null | undefined): Macroregion | null {
  if (!uf) return null;
  return UF_REGION[uf.trim().toUpperCase()] ?? null;
}

/** Brazilian phone area code (DDD) → UF. */
const DDD_UF: Record<string, string> = {};
{
  const add = (ufs: string, ...ddds: number[]) => ddds.forEach((d) => (DDD_UF[String(d)] = ufs));
  for (let d = 11; d <= 19; d++) add("SP", d);
  add("RJ", 21, 22, 24); add("ES", 27, 28);
  for (let d = 31; d <= 38; d++) add("MG", d);
  add("PR", 41, 42, 43, 44, 45, 46); add("SC", 47, 48, 49); add("RS", 51, 53, 54, 55);
  add("DF", 61); add("GO", 62, 64); add("TO", 63); add("MT", 65, 66); add("MS", 67);
  add("AC", 68); add("RO", 69);
  add("BA", 71, 73, 74, 75, 77); add("SE", 79); add("PE", 81, 87); add("AL", 82);
  add("PB", 83); add("RN", 84); add("CE", 85, 88); add("PI", 86, 89);
  add("PA", 91, 93, 94); add("AM", 92, 97); add("RR", 95); add("AP", 96); add("MA", 98, 99);
}
/** Best-effort UF from a phone string (ABRACRO has no explicit geography column). */
export function dddToUf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2); // drop country code
  const ddd = digits.slice(0, 2);
  return DDD_UF[ddd] ?? null;
}

// ── Cell helpers ─────────────────────────────────────────────────────────────────
export function truthy(v: string | undefined | null): boolean {
  const s = (v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "sim" || s === "yes" || s === "x";
}
function clean(v: string | undefined | null): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}
function digitsOrNull(v: string | undefined | null): string | null {
  const s = (v ?? "").replace(/\D/g, "");
  return s.length ? s : null;
}
export function normName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TA_COLUMNS: [number, string][] = [
  [6, "Alergia/Imunologia"], [7, "Cardiovascular"], [8, "Dermatologia"], [9, "Doenças Infecciosas"],
  [10, "Endocrinologia"], [11, "Gastrointestinal"], [12, "Hematologia"], [13, "Hepatologia"],
  [14, "Nefrologia"], [15, "Neurologia"], [16, "Oftalmologia"], [17, "Oncologia"], [18, "Ortopedia"],
  [19, "Psiquiátricos"], [20, "Respiratório"], [21, "Reumatologia"], [22, "Saúde da Mulher"],
  [23, "Transplante"], [24, "Vacinas"],
];

/** Parse the ABRACRO sheet rows (header at row 0). */
export function parseAbracro(rows: string[][]): DirectorySite[] {
  const out: DirectorySite[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = clean(r[28]); // Instituição/Hospital
    if (!name) continue; // a row with no institution is not a site
    const cnes = digitsOrNull(r[29]);
    const therapeuticAreas = TA_COLUMNS.filter(([idx]) => truthy(r[idx])).map(([, label]) => label);
    const uf = dddToUf(r[3]) ?? dddToUf(r[31]) ?? dddToUf(r[4]);
    const anvisa = truthy(r[36]), fda = truthy(r[37]), ema = truthy(r[38]);
    out.push({
      id: cnes ? `cnes-${cnes}` : `abr-${normName(name).replace(/\s+/g, "-")}`,
      name,
      cnes,
      cnpj: null,
      city: null,
      uf,
      region: ufToRegion(uf),
      therapeuticAreas,
      oncology: truthy(r[17]),
      cepName: clean(r[32]),
      inspections: { anvisa, fda, ema, any: anvisa || fda || ema || truthy(r[35]) || truthy(r[39]) },
      edcExperience: truthy(r[33]),
      rbmExperience: truthy(r[34]),
      centralLabExams: truthy(r[40]),
      centralLabImaging: truthy(r[41]),
      piCount: r[2] && /^\d+$/.test(r[2].trim()) ? Number(r[2].trim()) : null,
      contactName: clean(r[0]),
      contactEmail: clean(r[5]) ?? clean(r[30]),
      contactPhone: clean(r[3]) ?? clean(r[31]),
      sources: ["abracro"],
    });
  }
  return out;
}

/** Parse the ACESSE sheet rows (header at row 0). */
export function parseAcesse(rows: string[][]): DirectorySite[] {
  const out: DirectorySite[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = clean(r[4]); // EMPRESA
    if (!name) continue;
    const uf = clean(r[7])?.toUpperCase() ?? null;
    out.push({
      id: `acesse-${normName(name).replace(/\s+/g, "-")}`,
      name,
      cnes: null,
      cnpj: digitsOrNull(r[3]),
      city: clean(r[6]),
      uf,
      region: ufToRegion(uf),
      therapeuticAreas: [],
      oncology: false,
      cepName: null,
      inspections: { anvisa: false, fda: false, ema: false, any: false },
      edcExperience: false,
      rbmExperience: false,
      centralLabExams: false,
      centralLabImaging: false,
      piCount: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      sources: ["acesse"],
    });
  }
  return out;
}

/** Merge + dedupe across both lists: by CNES when present, else normalized name. */
export function mergeDirectory(...lists: DirectorySite[][]): DirectorySite[] {
  const byKey = new Map<string, DirectorySite>();
  for (const site of lists.flat()) {
    const key = site.cnes ? `cnes:${site.cnes}` : `name:${normName(site.name)}`;
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, { ...site });
    else byKey.set(key, mergeTwo(existing, site));
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeTwo(a: DirectorySite, b: DirectorySite): DirectorySite {
  const pick = <T>(x: T | null, y: T | null): T | null => (x != null && x !== "" ? x : y);
  return {
    ...a,
    cnes: pick(a.cnes, b.cnes),
    cnpj: pick(a.cnpj, b.cnpj),
    city: pick(a.city, b.city),
    uf: pick(a.uf, b.uf),
    region: a.region ?? b.region,
    therapeuticAreas: [...new Set([...a.therapeuticAreas, ...b.therapeuticAreas])],
    oncology: a.oncology || b.oncology,
    cepName: pick(a.cepName, b.cepName),
    inspections: {
      anvisa: a.inspections.anvisa || b.inspections.anvisa,
      fda: a.inspections.fda || b.inspections.fda,
      ema: a.inspections.ema || b.inspections.ema,
      any: a.inspections.any || b.inspections.any,
    },
    edcExperience: a.edcExperience || b.edcExperience,
    rbmExperience: a.rbmExperience || b.rbmExperience,
    centralLabExams: a.centralLabExams || b.centralLabExams,
    centralLabImaging: a.centralLabImaging || b.centralLabImaging,
    piCount: a.piCount ?? b.piCount,
    contactName: pick(a.contactName, b.contactName),
    contactEmail: pick(a.contactEmail, b.contactEmail),
    contactPhone: pick(a.contactPhone, b.contactPhone),
    sources: [...new Set([...a.sources, ...b.sources])] as DirectorySource[],
  };
}

export interface DirectoryStats {
  total: number;
  withCnes: number;
  oncology: number;
  withRegion: number;
  byRegion: Record<string, number>;
  bySource: Record<string, number>;
  anvisaInspected: number;
}
export function directoryStats(sites: DirectorySite[]): DirectoryStats {
  const byRegion: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const s of sites) {
    if (s.region) byRegion[s.region] = (byRegion[s.region] ?? 0) + 1;
    for (const src of s.sources) bySource[src] = (bySource[src] ?? 0) + 1;
  }
  return {
    total: sites.length,
    withCnes: sites.filter((s) => s.cnes).length,
    oncology: sites.filter((s) => s.oncology).length,
    withRegion: sites.filter((s) => s.region).length,
    byRegion,
    bySource,
    anvisaInspected: sites.filter((s) => s.inspections.anvisa).length,
  };
}
