/** Server-only access to the restricted facility-master PI roster. */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadEnrichmentStore } from "@/lib/kol/enrichmentStore";
import { loadCtgovInvestigatorRoster } from "@/lib/ctgov/investigatorRoster";
import {
  buildInvestigatorDirectory,
  type InvestigatorDirectory,
  type InvestigatorRosterRow,
} from "@/lib/kol/directoryModel";

const DEFAULT_DB_PATH = "data/facility-master/facility-master.v1.sqlite";

function readRoster(dbPath: string): { rows: InvestigatorRosterRow[]; generatedAt: string | null } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT
        p.person_id AS personId,
        p.display_name AS displayName,
        f.facility_id AS facilityId,
        f.report_display_name AS facilityName,
        f.city,
        f.uf,
        (SELECT i.value FROM facility_identifiers i WHERE i.facility_id = f.facility_id AND i.system = 'CNES' AND i.validation_status = 'valid' ORDER BY i.value LIMIT 1) AS confirmedCnes,
        (SELECT i.value FROM facility_identifiers i WHERE i.facility_id = f.facility_id AND i.system = 'CNES' AND i.validation_status = 'unverified' ORDER BY i.value LIMIT 1) AS unverifiedCnes
      FROM persons p
      JOIN person_facility_roles r ON r.person_id = p.person_id AND r.role = 'investigator'
      JOIN facilities f ON f.facility_id = r.facility_id
      ORDER BY p.display_name, f.report_display_name
    `).all() as unknown as InvestigatorRosterRow[];
    const meta = db.prepare("SELECT value FROM meta WHERE key = 'generated_at'").get() as { value?: string } | undefined;
    return { rows, generatedAt: meta?.value ?? null };
  } finally {
    db.close();
  }
}

export function loadInvestigatorDirectory(): InvestigatorDirectory {
  const enrichments = loadEnrichmentStore();
  const ctgovRoster = loadCtgovInvestigatorRoster();
  const dbPath = process.env.TB_FACILITY_MASTER_DB ?? DEFAULT_DB_PATH;
  if (!existsSync(dbPath)) return buildInvestigatorDirectory([], enrichments, null, false, ctgovRoster);
  try {
    const { rows, generatedAt } = readRoster(dbPath);
    return buildInvestigatorDirectory(rows, enrichments, generatedAt, true, ctgovRoster);
  } catch {
    return buildInvestigatorDirectory([], enrichments, null, false, ctgovRoster);
  }
}
