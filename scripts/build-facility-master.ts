import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { xlsxRows } from "@/lib/intake/adapters/xlsx";
import { dddToUf, truthy } from "@/lib/sites/directory";
import {
  buildFacilityMaster,
  cnesIdentifier,
  cnpjIdentifier,
  digits,
  type FacilityIdentifier,
  type FacilityObservation,
  type FacilitySourceRecord,
  normalizeFacilityName,
  normalizeUf,
  sourceRecordId,
  stableHash,
} from "@/lib/facilities/master";

interface SiteMapSite {
  site_id: string;
  name: string;
  name_normalized?: string;
  is_placeholder?: boolean;
  city?: string | null;
  state?: string | null;
  country: string;
  activity_status: "active" | "dormant" | "unverified";
  trial_refs?: string[];
  trial_count?: number;
  active_trial_count?: number;
  registry_refs?: string[];
  provenance?: { discovered_via?: string[] };
}

interface AssociationSeed {
  name_normalized: string;
  matched_site_id: string | null;
  match_score: number | null;
}

interface OmopCareSite {
  care_site_id: number;
  care_site_name: string;
  location_source_value: string;
  location_uf_value: string;
  care_site_source_value: string;
  care_site_snomed_concept_code: string | null;
}

interface RosterCandidate {
  name: string;
  email: string | null;
  role: "investigator" | "coordinator";
  sourceRecordId: string;
}

interface OfficialGeo {
  city: string | null;
  uf: string | null;
}

interface SeedResolutionContext {
  sitesById: Map<string, FacilitySourceRecord>;
  officialGeoByCnes: Map<string, OfficialGeo>;
}

const TA_COLUMNS: [number, string][] = [
  [6, "Alergia/Imunologia"], [7, "Cardiovascular"], [8, "Dermatologia"], [9, "Doenças Infecciosas"],
  [10, "Endocrinologia"], [11, "Gastrointestinal"], [12, "Hematologia"], [13, "Hepatologia"],
  [14, "Nefrologia"], [15, "Neurologia"], [16, "Oftalmologia"], [17, "Oncologia"],
  [18, "Ortopedia"], [19, "Psiquiátricos"], [20, "Respiratório"], [21, "Reumatologia"],
  [22, "Saúde da Mulher"], [23, "Transplante"], [24, "Vacinas"],
];

const DEFAULTS = {
  abracro: `${homedir()}/Downloads/ABRACRO_Planilha de Centros de Pesquisa_28Jan2025 (2).xlsx`,
  acesse: `${homedir()}/Downloads/Associados ACESSE - Controle de Centros (2).xlsx`,
  sitemap: `${homedir()}/SiteMapTool/public/data/sites.json`,
  seeds: `${homedir()}/SiteMapTool/data/seeds/br-association-centers.json`,
  merges: `${homedir()}/SiteMapTool/data/merges.json`,
  omop: "data/omop-sus-last10pct/care_site/*.parquet",
  out: "data/facility-master",
};

function args(): typeof DEFAULTS {
  const values = { ...DEFAULTS };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, "") as keyof typeof DEFAULTS;
    if (!(key in values) || !process.argv[i + 1]) throw new Error(`Unknown or incomplete argument: ${process.argv[i]}`);
    values[key] = process.argv[i + 1];
  }
  return values;
}

function rows(path: string): string[][] {
  return xlsxRows(new Uint8Array(readFileSync(path)));
}

function observation(sourceRecordId: string, field: string, value: unknown, sourceClass: FacilityObservation["sourceClass"], observedAt: string | null, assertion?: FacilityObservation["assertion"]): FacilityObservation {
  const resolved = assertion ?? (value == null ? "unknown" : typeof value === "boolean" ? (value ? "yes" : "no") : "value");
  return { field, value, assertion: resolved, sourceRecordId, sourceClass, observedAt };
}

function sitemapIdentifier(siteId: string | null | undefined, recordId: string): FacilityIdentifier[] {
  return siteId ? [{ system: "SITEMAP", value: siteId, validationStatus: "valid", sourceRecordId: recordId }] : [];
}

function associationCnesIdentifier(raw: unknown, recordId: string, context: SeedResolutionContext): FacilityIdentifier | null {
  const identifier = cnesIdentifier(raw, recordId);
  if (identifier?.validationStatus === "valid" && !context.officialGeoByCnes.has(identifier.value)) identifier.validationStatus = "unverified";
  return identifier;
}

function resolveSeedLink(
  seed: AssociationSeed | undefined,
  recordId: string,
  normalizedName: string,
  associationCity: string | null,
  associationUf: string | null,
  geoMethod: FacilitySourceRecord["geoMethod"],
  rawCnes: unknown,
  context: SeedResolutionContext,
): { identifiers: FacilityIdentifier[]; decision: string; reason: string } {
  if (!seed?.matched_site_id) return { identifiers: [], decision: "no_seed_match", reason: "No SiteMap candidate in the association seed." };
  const target = context.sitesById.get(seed.matched_site_id);
  if (!target) return { identifiers: [], decision: "rejected", reason: "The seeded SiteMap target is absent from the eligible non-placeholder registry." };

  const cnes = digits(rawCnes);
  const official = cnes.length === 7 ? context.officialGeoByCnes.get(cnes) : undefined;
  const comparableCity = (value: string | null | undefined) => normalizeFacilityName(value ?? "");
  const targetCity = comparableCity(target.city);
  const officialCity = comparableCity(official?.city);
  const associationCityNormalized = comparableCity(associationCity);
  if (official?.uf && target.uf && official.uf !== target.uf) {
    return { identifiers: [], decision: "rejected", reason: `Official CNES UF ${official.uf} conflicts with SiteMap UF ${target.uf}.` };
  }
  if (officialCity && targetCity && officialCity !== targetCity) {
    return { identifiers: [], decision: "rejected", reason: `Official CNES city ${official?.city} conflicts with SiteMap city ${target.city}.` };
  }
  if (!official && associationUf && target.uf && associationUf !== target.uf) {
    return { identifiers: [], decision: "rejected", reason: `${geoMethod} UF ${associationUf} conflicts with SiteMap UF ${target.uf}.` };
  }
  if (!official && geoMethod === "declared" && associationCityNormalized && targetCity && associationCityNormalized !== targetCity) {
    return { identifiers: [], decision: "rejected", reason: `Declared city ${associationCity} conflicts with SiteMap city ${target.city}.` };
  }

  const score = seed.match_score ?? 0;
  const evidenceUf = official?.uf ?? associationUf;
  const geoCorroborated = Boolean(evidenceUf && target.uf && evidenceUf === target.uf);
  const exactName = normalizedName === target.normalizedName;
  if (geoCorroborated && score >= 0.9) {
    return { identifiers: sitemapIdentifier(seed.matched_site_id, recordId), decision: "accepted", reason: `Geography corroborated; seed score ${score.toFixed(4)}.` };
  }
  if (exactName && score >= 0.98 && (!evidenceUf || !target.uf)) {
    return { identifiers: sitemapIdentifier(seed.matched_site_id, recordId), decision: "accepted", reason: `Exact normalized name with seed score ${score.toFixed(4)} and no contradictory geography.` };
  }
  return { identifiers: [], decision: "rejected", reason: `Insufficient corroboration for seed score ${score.toFixed(4)}.` };
}

function followRename(value: string, renames: Record<string, string>): string {
  let current = value;
  const seen = new Set<string>();
  while (renames[current] && !seen.has(current)) {
    seen.add(current);
    current = renames[current];
  }
  return current;
}

function loadSeedIndex(path: string, renames: Record<string, string>): Map<string, AssociationSeed> {
  if (!existsSync(path)) return new Map();
  const json = JSON.parse(readFileSync(path, "utf8")) as { centers?: AssociationSeed[] };
  return new Map((json.centers ?? []).map((seed) => [seed.name_normalized, {
    ...seed,
    matched_site_id: seed.matched_site_id ? followRename(seed.matched_site_id, renames) : null,
  }]));
}

function buildAbracro(inputRows: string[][], seeds: Map<string, AssociationSeed>, context: SeedResolutionContext): { records: FacilitySourceRecord[]; roster: RosterCandidate[] } {
  const groups = new Map<string, string[][]>();
  for (const row of inputRows.slice(1)) {
    const name = (row[28] ?? "").trim();
    if (!name) continue;
    const key = `${normalizeFacilityName(name)}|${digits(row[29])}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const records: FacilitySourceRecord[] = [];
  const roster: RosterCandidate[] = [];
  for (const [key, group] of groups) {
    const name = group[0][28].trim();
    const normalizedName = normalizeFacilityName(name);
    const recordId = sourceRecordId("abracro", key);
    const rawCnes = group.map((row) => row[29]).find((value) => digits(value)) ?? null;
    const seed = seeds.get(normalizedName);
    const uf = group.map((row) => dddToUf(row[3]) ?? dddToUf(row[31]) ?? dddToUf(row[4])).find(Boolean) ?? null;
    const seedLink = resolveSeedLink(seed, recordId, normalizedName, null, uf, uf ? "ddd" : "unknown", rawCnes, context);
    const associationCnes = associationCnesIdentifier(rawCnes, recordId, context);
    const identifiers = [associationCnes, ...seedLink.identifiers].filter(Boolean) as FacilityIdentifier[];
    const areas = TA_COLUMNS.filter(([index]) => group.some((row) => truthy(row[index]))).map(([, label]) => label);
    const values = (index: number) => group.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    const maxPi = values(2).filter((value) => /^\d+$/.test(value)).map(Number).reduce((max, value) => Math.max(max, value), 0);
    const investigators = new Set(group.filter((row) => row[1]?.trim() === "Investigador").map((row) => normalizeFacilityName(row[0] ?? "")).filter(Boolean));
    const coordinators = new Set(group.filter((row) => row[1]?.trim() === "Coordenador de Centro").map((row) => normalizeFacilityName(row[0] ?? "")).filter(Boolean));
    records.push({
      sourceRecordId: recordId,
      source: "abracro",
      sourceKey: key,
      name,
      normalizedName,
      city: null,
      uf,
      geoMethod: uf ? "ddd" : "unknown",
      membershipStatus: "active",
      isPlaceholder: false,
      identifiers,
      observations: [
        observation(recordId, "association.abracro_member", true, "association", "2025-01-28"),
        observation(recordId, "research.therapeutic_areas", areas, "association", "2025-01-28"),
        observation(recordId, "research.oncology_experience", group.some((row) => truthy(row[17])), "association", "2025-01-28"),
        observation(recordId, "research.cep_name", values(32)[0] ?? null, "association", "2025-01-28"),
        observation(recordId, "research.edc_experience", group.some((row) => truthy(row[33])), "association", "2025-01-28"),
        observation(recordId, "research.rbm_experience", group.some((row) => truthy(row[34])), "association", "2025-01-28"),
        observation(recordId, "inspection.anvisa", group.some((row) => truthy(row[36])), "association", "2025-01-28"),
        observation(recordId, "inspection.fda", group.some((row) => truthy(row[37])), "association", "2025-01-28"),
        observation(recordId, "inspection.ema", group.some((row) => truthy(row[38])), "association", "2025-01-28"),
        observation(recordId, "research.central_lab_exams", group.some((row) => truthy(row[40])), "association", "2025-01-28"),
        observation(recordId, "research.central_lab_imaging", group.some((row) => truthy(row[41])), "association", "2025-01-28"),
        observation(recordId, "research.pi_count_declared", maxPi || null, "association", "2025-01-28"),
        observation(recordId, "research.roster_investigators", investigators.size, "association", "2025-01-28"),
        observation(recordId, "research.roster_coordinators", coordinators.size, "association", "2025-01-28"),
        observation(recordId, "resolution.sitemap_match_score", seed?.match_score ?? null, "association", "2025-01-28"),
        observation(recordId, "resolution.sitemap_match_decision", seedLink.decision, "association", "2025-01-28"),
        observation(recordId, "resolution.sitemap_match_reason", seedLink.reason, "association", "2025-01-28"),
        observation(recordId, "resolution.cnes_validation_status", associationCnes?.validationStatus ?? "absent", "association", "2025-01-28"),
      ],
      trialRefs: [],
      activeTrialCount: 0,
    });
    for (const row of group) {
      const role = row[1]?.trim() === "Investigador" ? "investigator" : row[1]?.trim() === "Coordenador de Centro" ? "coordinator" : null;
      const personName = (row[0] ?? "").trim();
      if (role && personName) roster.push({ name: personName, email: (row[5] ?? "").trim() || null, role, sourceRecordId: recordId });
    }
  }
  return { records, roster };
}

function buildAcesse(inputRows: string[][], seeds: Map<string, AssociationSeed>, context: SeedResolutionContext): FacilitySourceRecord[] {
  const records: FacilitySourceRecord[] = [];
  for (const row of inputRows.slice(1)) {
    const name = (row[4] ?? "").trim();
    if (!name) continue;
    const sourceKey = (row[0] ?? "").trim() || `${name}|${row[3] ?? ""}`;
    const recordId = sourceRecordId("acesse", sourceKey);
    const normalizedName = normalizeFacilityName(name);
    const seed = seeds.get(normalizedName);
    const cnpj = cnpjIdentifier(row[3], recordId);
    const inactive = Boolean((row[2] ?? "").trim());
    const city = (row[6] ?? "").trim() || null;
    const uf = normalizeUf(row[7]);
    const seedLink = resolveSeedLink(seed, recordId, normalizedName, city, uf, "declared", null, context);
    records.push({
      sourceRecordId: recordId,
      source: "acesse",
      sourceKey,
      name,
      normalizedName,
      city,
      uf,
      geoMethod: "declared",
      membershipStatus: inactive ? "inactive" : "active",
      isPlaceholder: false,
      identifiers: [cnpj, ...seedLink.identifiers].filter(Boolean) as FacilityIdentifier[],
      observations: [
        observation(recordId, "association.acesse_membership", inactive ? "inactive" : "active", "association", null),
        observation(recordId, "association.acesse_joined_excel_serial", Number(row[1]) || null, "association", null),
        observation(recordId, "association.acesse_exited_excel_serial", Number(row[2]) || null, "association", null),
        observation(recordId, "resolution.sitemap_match_score", seed?.match_score ?? null, "association", null),
        observation(recordId, "resolution.sitemap_match_decision", seedLink.decision, "association", null),
        observation(recordId, "resolution.sitemap_match_reason", seedLink.reason, "association", null),
      ],
      trialRefs: [],
      activeTrialCount: 0,
    });
  }
  return records;
}

function buildSiteMap(path: string): { records: FacilitySourceRecord[]; excludedPlaceholders: number } {
  const json = JSON.parse(readFileSync(path, "utf8")) as { sites?: SiteMapSite[] };
  let excludedPlaceholders = 0;
  const records: FacilitySourceRecord[] = [];
  for (const site of json.sites ?? []) {
    if (site.country !== "br") continue;
    if (site.is_placeholder) { excludedPlaceholders++; continue; }
    const recordId = sourceRecordId("sitemap", site.site_id);
    const activeStatus = site.activity_status === "active" ? "active" : site.activity_status === "dormant" ? "inactive" : "unknown";
    records.push({
      sourceRecordId: recordId,
      source: "sitemap",
      sourceKey: site.site_id,
      name: site.name,
      normalizedName: site.name_normalized ?? normalizeFacilityName(site.name),
      city: site.city ?? null,
      uf: normalizeUf(site.state),
      geoMethod: "registry",
      membershipStatus: activeStatus,
      isPlaceholder: false,
      identifiers: sitemapIdentifier(site.site_id, recordId),
      observations: [
        observation(recordId, "registry.trial_count", site.trial_count ?? (site.trial_refs ?? []).length, "registry", null),
        observation(recordId, "registry.active_trial_count", site.active_trial_count ?? 0, "registry", null),
        observation(recordId, "registry.registry_refs", site.registry_refs ?? [], "registry", null),
        observation(recordId, "registry.discovered_via", site.provenance?.discovered_via ?? [], "registry", null),
      ],
      trialRefs: site.trial_refs ?? [],
      activeTrialCount: site.active_trial_count ?? 0,
    });
  }
  return { records, excludedPlaceholders };
}

function buildOmop(parquetGlob: string): FacilitySourceRecord[] {
  const safeGlob = resolve(parquetGlob).replace(/'/g, "''");
  const sql = `SELECT care_site_id, care_site_name, location_source_value, location_uf_value, care_site_source_value, care_site_snomed_concept_code FROM read_parquet('${safeGlob}')`;
  const output = execFileSync(process.env.DUCKDB_BIN ?? "duckdb", ["-json", "-c", sql], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const rows = JSON.parse(output) as OmopCareSite[];
  return rows.map((site) => {
    const cnes = String(site.care_site_id).padStart(7, "0");
    const recordId = sourceRecordId("omop_care_site", cnes);
    return {
      sourceRecordId: recordId,
      source: "omop_care_site" as const,
      sourceKey: cnes,
      name: site.care_site_name,
      normalizedName: normalizeFacilityName(site.care_site_name),
      city: site.location_source_value,
      uf: normalizeUf(site.location_uf_value),
      geoMethod: "official" as const,
      membershipStatus: "unknown" as const,
      isPlaceholder: false,
      identifiers: [cnesIdentifier(cnes, recordId)!],
      observations: [
        observation(recordId, "official.facility_type", site.care_site_source_value, "official", null),
        observation(recordId, "official.snomed_code", site.care_site_snomed_concept_code, "official", null),
      ],
      trialRefs: [],
      activeTrialCount: 0,
    };
  });
}

function writeDatabase(outPath: string, schemaPath: string, records: FacilitySourceRecord[], result: ReturnType<typeof buildFacilityMaster>, roster: RosterCandidate[], generatedAt: string) {
  mkdirSync(dirname(outPath), { recursive: true });
  if (existsSync(outPath)) rmSync(outPath);
  const db = new DatabaseSync(outPath);
  db.exec(readFileSync(schemaPath, "utf8"));
  db.exec("BEGIN");
  const personIds = new Set<string>();
  const seenRoles = new Set<string>();
  try {
    const meta = db.prepare("INSERT INTO meta(key,value) VALUES (?,?)");
    meta.run("schema_version", "facility-master.v1");
    meta.run("generated_at", generatedAt);
    const facilityStmt = db.prepare("INSERT INTO facilities VALUES (?,?,?,?,?,?,?,?,?)");
    const sourceStmt = db.prepare("INSERT INTO source_records VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const identifierStmt = db.prepare("INSERT OR IGNORE INTO facility_identifiers VALUES (?,?,?,?,?)");
    const aliasStmt = db.prepare("INSERT OR IGNORE INTO facility_aliases VALUES (?,?,?,?)");
    const observationStmt = db.prepare("INSERT OR IGNORE INTO facility_observations VALUES (?,?,?,?,?,?,?,?)");
    const trialStmt = db.prepare("INSERT OR IGNORE INTO facility_trials VALUES (?,?,?)");
    const issueStmt = db.prepare("INSERT INTO resolution_issues(issue_id,kind,severity,source_record_ids_json,facility_ids_json,detail) VALUES (?,?,?,?,?,?)");
    const personStmt = db.prepare("INSERT OR IGNORE INTO persons VALUES (?,?,?,?)");
    const roleStmt = db.prepare("INSERT OR IGNORE INTO person_facility_roles VALUES (?,?,?,?)");

    for (const facility of result.facilities) facilityStmt.run(
      facility.facilityId, facility.canonicalName, facility.reportDisplayName, facility.city, facility.uf,
      facility.activityStatus, JSON.stringify(facility.sources), facility.trialRefs.length, facility.activeTrialCount,
    );
    for (const record of records) {
      const facilityId = result.recordToFacility[record.sourceRecordId];
      sourceStmt.run(record.sourceRecordId, record.source, record.sourceKey, facilityId, record.name, record.normalizedName, record.city, record.uf, record.geoMethod, record.membershipStatus, record.isPlaceholder ? 1 : 0);
      for (const identifier of record.identifiers) identifierStmt.run(facilityId, identifier.system, identifier.value, identifier.validationStatus, record.sourceRecordId);
      aliasStmt.run(facilityId, record.name, record.normalizedName, record.sourceRecordId);
      for (const [index, obs] of record.observations.entries()) observationStmt.run(
        `obs-${stableHash(`${record.sourceRecordId}|${obs.field}|${index}`)}`, facilityId, obs.field, JSON.stringify(obs.value), obs.assertion, obs.sourceClass, obs.sourceRecordId, obs.observedAt,
      );
      for (const trial of record.trialRefs) trialStmt.run(facilityId, trial, record.sourceRecordId);
    }
    for (const item of result.issues) issueStmt.run(item.issueId, item.kind, item.severity, JSON.stringify(item.sourceRecordIds), JSON.stringify(item.facilityIds), item.detail);

    for (const candidate of roster) {
      const facilityId = result.recordToFacility[candidate.sourceRecordId];
      if (!facilityId) continue;
      const normalizedName = normalizeFacilityName(candidate.name);
      const email = (candidate.email ?? "").trim().toLowerCase();
      const identityBasis = email.includes("@") ? "hashed_professional_email" : "name_facility_role";
      const personId = `pers-${stableHash(email.includes("@") ? email : `${normalizedName}|${facilityId}|${candidate.role}`)}`;
      personStmt.run(personId, candidate.name, normalizedName, identityBasis);
      personIds.add(personId);
      const roleKey = `${personId}|${facilityId}|${candidate.role}|${candidate.sourceRecordId}`;
      if (!seenRoles.has(roleKey)) {
        roleStmt.run(personId, facilityId, candidate.role, candidate.sourceRecordId);
        seenRoles.add(roleKey);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  return { persons: personIds.size, personFacilityRoles: seenRoles.size };
}

function main() {
  const config = args();
  for (const [key, path] of Object.entries(config)) if (key !== "out" && key !== "omop" && key !== "merges" && !existsSync(path)) throw new Error(`Missing ${key}: ${path}`);
  const renames = existsSync(config.merges) ? (JSON.parse(readFileSync(config.merges, "utf8")) as { renames?: Record<string, string> }).renames ?? {} : {};
  const seeds = loadSeedIndex(config.seeds, renames);
  const sitemap = buildSiteMap(config.sitemap);
  const omop = buildOmop(config.omop);
  const seedContext: SeedResolutionContext = {
    sitesById: new Map(sitemap.records.map((record) => [record.sourceKey, record])),
    officialGeoByCnes: new Map(omop.map((record) => [record.sourceKey, { city: record.city, uf: record.uf }])),
  };
  const abracro = buildAbracro(rows(config.abracro), seeds, seedContext);
  const acesse = buildAcesse(rows(config.acesse), seeds, seedContext);
  const records = [...omop, ...sitemap.records, ...abracro.records, ...acesse];
  const result = buildFacilityMaster(records);
  const generatedAt = new Date().toISOString();
  const outDir = resolve(config.out);
  mkdirSync(outDir, { recursive: true });
  const rosterStats = writeDatabase(join(outDir, "facility-master.v1.sqlite"), join(process.cwd(), "scripts/facility-master/schema.sql"), records, result, abracro.roster, generatedAt);

  const reportFacilities = result.facilities.filter((facility) => facility.sources.includes("abracro") || facility.sources.includes("acesse") || facility.sources.includes("sitemap"));
  const reportView = reportFacilities.map((facility) => ({
    facilityId: facility.facilityId,
    name: facility.reportDisplayName,
    officialName: facility.canonicalName,
    cnes: facility.identifiers.find((id) => id.system === "CNES" && id.validationStatus === "valid")?.value ?? null,
    city: facility.city,
    uf: facility.uf,
    activityStatus: facility.activityStatus,
    sources: facility.sources,
    trialCount: facility.trialRefs.length,
    activeTrialCount: facility.activeTrialCount,
    aliases: facility.aliases.map((alias) => alias.name),
    observations: facility.observations,
  }));
  const bySource = Object.fromEntries(["omop_care_site", "sitemap", "abracro", "acesse"].map((source) => [source, records.filter((record) => record.source === source).length]));
  const issueCounts = Object.fromEntries(["invalid_identifier", "identifier_conflict", "geography_conflict", "possible_duplicate"].map((kind) => [kind, result.issues.filter((item) => item.kind === kind).length]));
  const seedDecisionCounts: Record<string, number> = {};
  for (const record of [...abracro.records, ...acesse]) {
    const decision = String(record.observations.find((item) => item.field === "resolution.sitemap_match_decision")?.value ?? "unknown");
    seedDecisionCounts[decision] = (seedDecisionCounts[decision] ?? 0) + 1;
  }
  const summary = {
    schemaVersion: "facility-master.v1",
    generatedAt,
    sourceRecords: records.length,
    sourceRecordsBySource: bySource,
    facilities: result.facilities.length,
    reportFacilities: reportFacilities.length,
    facilitiesWithValidCnes: result.facilities.filter((facility) => facility.identifiers.some((id) => id.system === "CNES" && id.validationStatus === "valid")).length,
    facilitiesWithUnverifiedCnes: result.facilities.filter((facility) => facility.identifiers.some((id) => id.system === "CNES" && id.validationStatus === "unverified")).length,
    crossSourceFacilities: result.facilities.filter((facility) => facility.sources.length > 1).length,
    excludedSiteMapPlaceholders: sitemap.excludedPlaceholders,
    associationSeedDecisions: seedDecisionCounts,
    rosterRows: abracro.roster.length,
    persons: rosterStats.persons,
    personFacilityRoles: rosterStats.personFacilityRoles,
    resolutionIssues: result.issues.length,
    resolutionIssuesByKind: issueCounts,
  };
  writeFileSync(join(outDir, "facility-report-view.v1.json"), JSON.stringify({ schemaVersion: "facility-report-view.v1", generatedAt, facilities: reportView }, null, 2));
  writeFileSync(join(outDir, "resolution-review.v1.json"), JSON.stringify({ schemaVersion: "facility-resolution-review.v1", generatedAt, issues: result.issues }, null, 2));
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
