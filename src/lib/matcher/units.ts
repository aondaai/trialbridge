/**
 * D5 — lab unit canonicalization.
 *
 * Labs arrive in different units across sites/charts (creatinine mg/dL vs µmol/L,
 * hemoglobin g/dL vs g/L). Deterministic comparison on raw value+unit gives
 * silently-wrong pass/fail verdicts. We canonicalize both the patient value and
 * the criterion threshold to a single per-field canonical unit before comparing.
 *
 * KNOWN DEBT: only the conversions below are implemented. An unrecognised unit is
 * returned unchanged and flagged via `canonicalized: false`; the matcher then
 * treats a cross-unit comparison it cannot reconcile as `unknown` (never a wrong
 * pass/fail). Expanding this table is documented v-next work, not demo-blocking.
 */

/** Canonical unit per lab field. */
export const CANONICAL_UNIT: Record<string, string> = {
  creatinine: "mg/dL",
  bilirubin: "mg/dL",
  hemoglobin: "g/dL",
  anc: "10^9/L", // absolute neutrophil count
  platelets: "10^9/L",
  ast: "U/L",
  alt: "U/L",
};

type Conversion = (v: number) => number;

/** Conversions INTO the canonical unit, keyed by "field|fromUnit". */
const CONVERSIONS: Record<string, Conversion> = {
  // creatinine: 1 mg/dL = 88.42 µmol/L
  "creatinine|umol/L": (v) => v / 88.42,
  "creatinine|µmol/L": (v) => v / 88.42,
  // bilirubin: 1 mg/dL = 17.1 µmol/L
  "bilirubin|umol/L": (v) => v / 17.1,
  "bilirubin|µmol/L": (v) => v / 17.1,
  // hemoglobin: 1 g/dL = 10 g/L
  "hemoglobin|g/L": (v) => v / 10,
  // ANC / platelets: 1 x10^9/L = 1000 /µL  (e.g. 1500 /µL = 1.5 x10^9/L)
  "anc|/uL": (v) => v / 1000,
  "anc|/µL": (v) => v / 1000,
  "platelets|/uL": (v) => v / 1000,
  "platelets|/µL": (v) => v / 1000,
  "platelets|10^3/uL": (v) => v, // 10^3/µL is numerically equal to 10^9/L
  "platelets|10^3/µL": (v) => v,
};

export interface Canonicalized {
  value: number;
  unit: string;
  /** false when the unit was not recognised and could not be converted. */
  canonicalized: boolean;
}

/** Normalise a numeric field to its canonical unit. Idempotent on canonical input. */
export function canonicalizeLab(
  field: string,
  value: number,
  unit: string | null | undefined,
): Canonicalized {
  const canonical = CANONICAL_UNIT[field];
  // Field with no canonical unit (e.g. "age", "ecog") — pass through untouched.
  if (!canonical) {
    return { value, unit: unit ?? "", canonicalized: true };
  }
  const from = (unit ?? "").trim();
  if (from === "" || from === canonical) {
    return { value, unit: canonical, canonicalized: true };
  }
  const conv = CONVERSIONS[`${field}|${from}`];
  if (!conv) {
    return { value, unit: from, canonicalized: false };
  }
  return { value: conv(value), unit: canonical, canonicalized: true };
}
