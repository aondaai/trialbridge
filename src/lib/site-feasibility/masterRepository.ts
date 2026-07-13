import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { FacilityTrialRow } from "@/lib/site-feasibility/types";

const DEFAULT_DB_PATH = "data/facility-master/facility-master.v1.sqlite";
const SQLITE_BIND_CHUNK = 400;

interface RawFacilityTrialRow {
  facilityId: string;
  cnes: string | null;
  name: string;
  registrySiteName: string;
  city: string | null;
  uf: string | null;
  activityStatus: FacilityTrialRow["activityStatus"];
  totalTrialCount: number;
  activeTrialCount: number;
  hasConfirmedPi: number;
  nctId: string;
}

export function readFacilityTrialsForNcts(
  nctIds: string[],
  dbPath = process.env.TB_FACILITY_MASTER_DB ?? DEFAULT_DB_PATH,
): FacilityTrialRow[] {
  const ids = [...new Set(nctIds.map((id) => id.trim().toUpperCase()).filter(Boolean))];
  if (ids.length === 0 || !existsSync(dbPath)) return [];

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows: RawFacilityTrialRow[] = [];
  try {
    for (let offset = 0; offset < ids.length; offset += SQLITE_BIND_CHUNK) {
      const chunk = ids.slice(offset, offset + SQLITE_BIND_CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const result = db.prepare(`
        SELECT DISTINCT
          f.facility_id AS facilityId,
          (
            SELECT i.value
            FROM facility_identifiers i
            WHERE i.facility_id = f.facility_id
              AND i.system = 'CNES'
              AND i.validation_status = 'valid'
            ORDER BY i.value
            LIMIT 1
          ) AS cnes,
          f.report_display_name AS name,
          sr.name AS registrySiteName,
          f.city,
          f.uf,
          f.activity_status AS activityStatus,
          f.trial_count AS totalTrialCount,
          f.active_trial_count AS activeTrialCount,
          EXISTS(
            SELECT 1 FROM person_facility_roles pfr
            WHERE pfr.facility_id = f.facility_id AND pfr.role = 'investigator'
          ) AS hasConfirmedPi,
          ft.trial_id AS nctId
        FROM facility_trials ft
        JOIN facilities f ON f.facility_id = ft.facility_id
        JOIN source_records sr ON sr.source_record_id = ft.source_record_id
        WHERE ft.trial_id IN (${placeholders})
          AND sr.source = 'sitemap'
          AND sr.is_placeholder = 0
        ORDER BY f.report_display_name, ft.trial_id
      `).all(...chunk) as unknown as RawFacilityTrialRow[];
      rows.push(...result);
    }
  } finally {
    db.close();
  }

  const unique = new Map<string, RawFacilityTrialRow>();
  for (const row of rows) unique.set(`${row.facilityId}|${row.nctId}`, row);
  return [...unique.values()].map((row) => ({
    ...row,
    hasConfirmedPi: Boolean(row.hasConfirmedPi),
  }));
}
