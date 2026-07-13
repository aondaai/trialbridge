/**
 * Server-only loader for the sanitized facility master reporting view.
 * The generated JSON intentionally excludes the restricted nominal PI/coordinator roster.
 */
import { existsSync, readFileSync } from "node:fs";
import type { FacilityObservation, FacilitySource } from "@/lib/facilities/master";

export interface FacilityReportViewRecord {
  facilityId: string;
  name: string;
  officialName: string;
  cnes: string | null;
  city: string | null;
  uf: string | null;
  activityStatus: "active" | "dormant" | "unverified";
  sources: FacilitySource[];
  trialCount: number;
  activeTrialCount: number;
  aliases: string[];
  observations: FacilityObservation[];
}

interface FacilityReportViewFile {
  schemaVersion: "facility-report-view.v1";
  generatedAt: string;
  facilities: FacilityReportViewRecord[];
}

const DEFAULT_VIEW_PATH = "data/facility-master/facility-report-view.v1.json";
let cache: FacilityReportViewFile | null = null;

export function loadFacilityReportView(): FacilityReportViewFile {
  if (cache) return cache;
  const path = process.env.TB_FACILITY_MASTER_VIEW ?? DEFAULT_VIEW_PATH;
  try {
    cache = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8")) as FacilityReportViewFile
      : { schemaVersion: "facility-report-view.v1", generatedAt: "", facilities: [] };
  } catch {
    cache = { schemaVersion: "facility-report-view.v1", generatedAt: "", facilities: [] };
  }
  return cache;
}
