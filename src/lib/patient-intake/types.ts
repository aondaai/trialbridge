import type { Patient } from "@/lib/matcher/types";

export type ScalarField = "id" | "diagnosis" | "stage" | "priorLines" | "ecog" | "sex" | "age";
export type MarkerField = "her2_status" | "er_status" | "pr_status";
export type LabField = "creatinine" | "hemoglobin" | "platelets" | "bilirubin" | "ejection_fraction";
export type MapTarget = ScalarField | MarkerField | LabField | "biomarker" | "ignore";

export interface ColumnMapping { column: string; target: MapTarget; samples: string[]; }
export interface IntakeStats { rows: number; columnsMapped: number; columnsIgnored: number; cellsUnparsed: number; }
export type TrustTier = "high" | "medium" | "low";
export interface PatientProvenance { adapter: string; extraction: "csv" | "xlsx"; trust: TrustTier; note: string; }
export interface PatientIntakeResult {
  patients: Patient[];
  mapping: ColumnMapping[];
  stats: IntakeStats;
  provenance: PatientProvenance;
}
export type PatientSourceInput = { kind: "text"; text: string } | { kind: "file"; filename: string; bytes: Uint8Array };
export interface PatientSourceAdapter {
  id: string;
  detect(input: PatientSourceInput): number;
  extract(input: PatientSourceInput, override?: Record<number, MapTarget>): Promise<PatientIntakeResult>;
}
