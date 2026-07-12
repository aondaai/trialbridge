import { PatientRegistry } from "./registry";
import { csvAdapter } from "./csvAdapter";

export type {
  PatientIntakeResult, PatientProvenance, ColumnMapping, IntakeStats, MapTarget, PatientSourceInput, PatientSourceAdapter, TrustTier,
} from "./types";
export { PatientRegistry } from "./registry";

export function defaultPatientRegistry(): PatientRegistry {
  return new PatientRegistry().register(csvAdapter);
}
