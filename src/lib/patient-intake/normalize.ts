/**
 * Per-field value normalizers. EVERY function returns null on anything it can't
 * confidently parse — that null becomes an `unknown` in the matcher (never a
 * fabricated value). Labs are canonicalized to their fixed unit via units.ts.
 */
import { canonicalizeLab } from "@/lib/matcher/units";
import type { LabField } from "./types";

export function normalizeInt(raw: string, min: number, max: number): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function normalizeSex(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (["f", "female", "feminino", "mulher"].includes(t)) return "female";
  if (["m", "male", "masculino", "homem"].includes(t)) return "male";
  return null;
}

export function normalizeMarker(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t === "") return null;
  if (/^(3\+|2\+|pos|positive|positivo|\+|amplified|amplificado)$/.test(t)) return "positive";
  if (/^(0|1\+|neg|negative|negativo|-|not amplified)$/.test(t)) return "negative";
  return null;
}

const ROMAN: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV" };
export function normalizeStage(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/\b(IV|III|II|I|[1-4])\b/);
  if (!m) return null;
  return ROMAN[m[1]] ?? m[1];
}

export function parseLab(field: LabField, raw: string, headerUnit: string | null): { value: number; unit: string } | null {
  const t = raw.trim();
  if (t === "") return null;
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (m[2].trim() || headerUnit || "").trim() || null;
  const c = canonicalizeLab(field, value, unit);
  // Unreconcilable unit → cannot compare; treat as unknown rather than wrong.
  if (!c.canonicalized) return null;
  return { value: c.value, unit: c.unit };
}

export function slugColumn(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
