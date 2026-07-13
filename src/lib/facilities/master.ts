import { createHash } from "node:crypto";

export type FacilitySource = "omop_care_site" | "sitemap" | "abracro" | "acesse";
export type ValidationStatus = "valid" | "invalid" | "unverified";
export type Assertion = "yes" | "no" | "unknown" | "value";

export interface FacilityIdentifier {
  system: "CNES" | "CNPJ" | "SITEMAP";
  value: string;
  validationStatus: ValidationStatus;
  sourceRecordId: string;
}

export interface FacilityObservation {
  field: string;
  value: unknown;
  assertion: Assertion;
  sourceRecordId: string;
  sourceClass: "official" | "registry" | "association";
  observedAt: string | null;
}

export interface FacilitySourceRecord {
  sourceRecordId: string;
  source: FacilitySource;
  sourceKey: string;
  name: string;
  normalizedName: string;
  city: string | null;
  uf: string | null;
  geoMethod: "official" | "registry" | "declared" | "ddd" | "unknown";
  membershipStatus: "active" | "inactive" | "unknown";
  isPlaceholder: boolean;
  identifiers: FacilityIdentifier[];
  observations: FacilityObservation[];
  trialRefs: string[];
  activeTrialCount: number;
}

export interface MasterFacility {
  facilityId: string;
  canonicalName: string;
  reportDisplayName: string;
  city: string | null;
  uf: string | null;
  activityStatus: "active" | "dormant" | "unverified";
  identifiers: FacilityIdentifier[];
  aliases: Array<{ name: string; normalizedName: string; sourceRecordId: string }>;
  observations: FacilityObservation[];
  sourceRecordIds: string[];
  sources: FacilitySource[];
  trialRefs: string[];
  activeTrialCount: number;
}

export interface ResolutionIssue {
  issueId: string;
  kind: "invalid_identifier" | "identifier_conflict" | "geography_conflict" | "possible_duplicate";
  severity: "high" | "medium" | "low";
  sourceRecordIds: string[];
  facilityIds: string[];
  detail: string;
}

export interface FacilityMasterResult {
  facilities: MasterFacility[];
  issues: ResolutionIssue[];
  recordToFacility: Record<string, string>;
}

const TOKEN_MAP: Record<string, string> = {
  hosp: "hospital",
  univ: "universidad",
  universidade: "universidad",
  university: "universidad",
  inst: "instituto",
  institute: "instituto",
  fund: "fundacion",
  fundacao: "fundacion",
  foundation: "fundacion",
  sta: "santa",
  sto: "santo",
};

const BR_UF: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

export function normalizeFacilityName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => TOKEN_MAP[token] ?? token)
    .join(" ");
}

export function normalizeUf(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return BR_UF[normalizeFacilityName(raw)] ?? null;
}

export function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function cnesIdentifier(raw: unknown, sourceRecordId: string): FacilityIdentifier | null {
  const value = digits(raw);
  if (!value) return null;
  return { system: "CNES", value, validationStatus: value.length === 7 ? "valid" : "invalid", sourceRecordId };
}

export function isValidCnpj(raw: unknown): boolean {
  const value = digits(raw);
  if (value.length !== 14 || /^(\d)\1{13}$/.test(value)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, n, i) => total + Number(n) * weights[i], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const d1 = calc(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(value.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${d1}${d2}`);
}

export function cnpjIdentifier(raw: unknown, sourceRecordId: string): FacilityIdentifier | null {
  const value = digits(raw);
  if (!value) return null;
  return { system: "CNPJ", value, validationStatus: isValidCnpj(value) ? "valid" : "invalid", sourceRecordId };
}

export function stableHash(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function sourceRecordId(source: FacilitySource, sourceKey: string): string {
  return `src-${source}-${stableHash(sourceKey)}`;
}

class UnionFind {
  private parent = new Map<string, string>();
  add(value: string) { if (!this.parent.has(value)) this.parent.set(value, value); }
  find(value: string): string {
    const current = this.parent.get(value);
    if (!current) { this.add(value); return value; }
    if (current === value) return value;
    const root = this.find(current);
    this.parent.set(value, root);
    return root;
  }
  union(a: string, b: string): string {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return ra;
    if (ra < rb) { this.parent.set(rb, ra); return ra; }
    this.parent.set(ra, rb);
    return rb;
  }
}

const NAME_PRIORITY: Record<FacilitySource, number> = { omop_care_site: 4, abracro: 3, acesse: 2, sitemap: 1 };
const REPORT_NAME_PRIORITY: Record<FacilitySource, number> = { abracro: 4, acesse: 3, sitemap: 2, omop_care_site: 1 };
const GEO_PRIORITY: Record<FacilitySourceRecord["geoMethod"], number> = { official: 5, declared: 4, registry: 3, ddd: 1, unknown: 0 };

function pickRecord(records: FacilitySourceRecord[], priority: Record<FacilitySource, number>): FacilitySourceRecord {
  const usefulName = (record: FacilitySourceRecord) => record.normalizedName.replace(/\s/g, "").length >= 4 ? 1 : 0;
  return [...records].sort((a, b) => priority[b.source] - priority[a.source] || usefulName(b) - usefulName(a) || a.name.localeCompare(b.name))[0];
}

function facilityIdFor(records: FacilitySourceRecord[]): string {
  const identifiers = records.flatMap((record) => record.identifiers);
  const cnes = identifiers.find((id) => id.system === "CNES" && id.validationStatus === "valid");
  if (cnes) return `fac-br-cnes-${cnes.value}`;
  const sitemap = identifiers.find((id) => id.system === "SITEMAP" && id.validationStatus === "valid");
  if (sitemap) return `fac-${sitemap.value}`;
  const cnpj = identifiers.find((id) => id.system === "CNPJ" && id.validationStatus === "valid");
  if (cnpj) return `fac-br-cnpj-${cnpj.value}`;
  const seed = records.map((r) => `${r.normalizedName}|${r.uf ?? ""}|${normalizeFacilityName(r.city ?? "")}|${r.sourceRecordId}`).sort()[0];
  return `fac-br-provisional-${stableHash(seed)}`;
}

function issue(kind: ResolutionIssue["kind"], severity: ResolutionIssue["severity"], records: string[], facilities: string[], detail: string): ResolutionIssue {
  return { issueId: `issue-${stableHash(`${kind}|${[...records].sort().join("|")}|${detail}`)}`, kind, severity, sourceRecordIds: [...new Set(records)], facilityIds: [...new Set(facilities)], detail };
}

export function buildFacilityMaster(records: FacilitySourceRecord[]): FacilityMasterResult {
  const uf = new UnionFind();
  const byIdentifier = new Map<string, string[]>();
  const cnesByRoot = new Map<string, Set<string>>();
  const membersByRoot = new Map<string, Set<string>>();
  for (const record of records) {
    uf.add(record.sourceRecordId);
    cnesByRoot.set(record.sourceRecordId, new Set(record.identifiers.filter((id) => id.system === "CNES" && id.validationStatus === "valid").map((id) => id.value)));
    membersByRoot.set(record.sourceRecordId, new Set([record.sourceRecordId]));
    for (const identifier of record.identifiers) {
      if (identifier.validationStatus !== "valid") continue;
      const key = `${identifier.system}|${identifier.value}`;
      const bucket = byIdentifier.get(key) ?? [];
      bucket.push(record.sourceRecordId);
      byIdentifier.set(key, bucket);
    }
  }
  const pendingIdentifierConflicts: Array<{ records: string[]; detail: string }> = [];
  const identifierBuckets = [...byIdentifier.entries()].sort(([a], [b]) => {
    const priority = (key: string) => key.startsWith("CNES|") ? 0 : key.startsWith("CNPJ|") ? 1 : 2;
    return priority(a) - priority(b) || a.localeCompare(b);
  });
  for (const [identifierKey, bucket] of identifierBuckets) for (let i = 1; i < bucket.length; i++) {
    const rootA = uf.find(bucket[0]);
    const rootB = uf.find(bucket[i]);
    if (rootA === rootB) continue;
    const cnesA = cnesByRoot.get(rootA) ?? new Set<string>();
    const cnesB = cnesByRoot.get(rootB) ?? new Set<string>();
    const combinedCnes = new Set([...cnesA, ...cnesB]);
    if (cnesA.size > 0 && cnesB.size > 0 && combinedCnes.size > 1) {
      pendingIdentifierConflicts.push({
        records: [...(membersByRoot.get(rootA) ?? []), ...(membersByRoot.get(rootB) ?? [])],
        detail: `${identifierKey} would merge conflicting CNES values: ${[...combinedCnes].sort().join(", ")}`,
      });
      continue;
    }
    const combinedMembers = new Set([...(membersByRoot.get(rootA) ?? []), ...(membersByRoot.get(rootB) ?? [])]);
    const newRoot = uf.union(rootA, rootB);
    const oldRoot = newRoot === rootA ? rootB : rootA;
    cnesByRoot.set(newRoot, combinedCnes);
    membersByRoot.set(newRoot, combinedMembers);
    cnesByRoot.delete(oldRoot);
    membersByRoot.delete(oldRoot);
  }

  const groups = new Map<string, FacilitySourceRecord[]>();
  for (const record of records) {
    const root = uf.find(record.sourceRecordId);
    const group = groups.get(root) ?? [];
    group.push(record);
    groups.set(root, group);
  }

  const facilities: MasterFacility[] = [];
  const recordToFacility: Record<string, string> = {};
  const issues: ResolutionIssue[] = [];

  for (const group of groups.values()) {
    const facilityId = facilityIdFor(group);
    const canonical = pickRecord(group, NAME_PRIORITY);
    const reportName = pickRecord(group, REPORT_NAME_PRIORITY);
    const geo = [...group].sort((a, b) => GEO_PRIORITY[b.geoMethod] - GEO_PRIORITY[a.geoMethod])[0];
    const identifiers = [...new Map(group.flatMap((record) => record.identifiers).map((id) => [`${id.system}|${id.value}|${id.validationStatus}`, id])).values()];
    const aliases = [...new Map(group.map((record) => [record.normalizedName, { name: record.name, normalizedName: record.normalizedName, sourceRecordId: record.sourceRecordId }])).values()];
    const trials = [...new Set(group.flatMap((record) => record.trialRefs))].sort();
    const sources = [...new Set(group.map((record) => record.source))];
    const hasActive = group.some((record) => record.source === "sitemap" && record.membershipStatus === "active");
    const hasDormant = group.some((record) => record.source === "sitemap" && record.membershipStatus === "inactive");
    facilities.push({
      facilityId,
      canonicalName: canonical.name,
      reportDisplayName: reportName.name,
      city: geo.city,
      uf: geo.uf,
      activityStatus: hasActive ? "active" : hasDormant ? "dormant" : "unverified",
      identifiers,
      aliases,
      observations: group.flatMap((record) => record.observations),
      sourceRecordIds: group.map((record) => record.sourceRecordId),
      sources,
      trialRefs: trials,
      activeTrialCount: Math.max(0, ...group.map((record) => record.activeTrialCount)),
    });
    for (const record of group) recordToFacility[record.sourceRecordId] = facilityId;

    const ufs = [...new Set(group.map((record) => record.uf).filter(Boolean))];
    if (ufs.length > 1) issues.push(issue("geography_conflict", "high", group.map((r) => r.sourceRecordId), [facilityId], `Conflicting UFs: ${ufs.join(", ")}`));
    for (const record of group) for (const identifier of record.identifiers) {
      if (identifier.validationStatus === "invalid") issues.push(issue("invalid_identifier", "high", [record.sourceRecordId], [facilityId], `${identifier.system} invalid: ${identifier.value}`));
    }
  }

  const possible = new Map<string, MasterFacility[]>();
  for (const facility of facilities) {
    if (!facility.uf || !facility.city) continue;
    const key = `${normalizeFacilityName(facility.reportDisplayName)}|${normalizeFacilityName(facility.city)}|${facility.uf}`;
    const bucket = possible.get(key) ?? [];
    bucket.push(facility);
    possible.set(key, bucket);
  }
  for (const bucket of possible.values()) if (bucket.length > 1) {
    issues.push(issue("possible_duplicate", "medium", bucket.flatMap((f) => f.sourceRecordIds), bucket.map((f) => f.facilityId), `Exact normalized name/city/UF remains split across ${bucket.length} entities.`));
  }
  for (const conflict of pendingIdentifierConflicts) {
    issues.push(issue("identifier_conflict", "high", conflict.records, conflict.records.map((recordId) => recordToFacility[recordId]).filter(Boolean), conflict.detail));
  }

  return {
    facilities: facilities.sort((a, b) => a.facilityId.localeCompare(b.facilityId)),
    issues: issues.sort((a, b) => a.issueId.localeCompare(b.issueId)),
    recordToFacility,
  };
}
