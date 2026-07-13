/** Server-only loader for the materialized Brazil CT.gov official/investigator roster. */
import { existsSync, readFileSync } from "node:fs";
import type { CtgovInvestigatorRoster } from "@/lib/ctgov/investigatorRosterModel";

const DEFAULT_PATH = "data/ctgov-investigators-br.json";

export function loadCtgovInvestigatorRoster(): CtgovInvestigatorRoster | null {
  const path = process.env.TB_CTGOV_INVESTIGATOR_ROSTER ?? DEFAULT_PATH;
  try {
    if (!existsSync(path)) return null;
    const roster = JSON.parse(readFileSync(path, "utf8")) as CtgovInvestigatorRoster;
    return roster.schemaVersion === "ctgov-investigator-roster.v1" ? roster : null;
  } catch {
    return null;
  }
}
