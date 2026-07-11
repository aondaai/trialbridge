/**
 * Archetype A resolver — static institutional facts (spec §6, resolver 4a).
 *
 * Deterministic lookup over the InstitutionProfile cadastre. Every answer is a
 * `Metric` sealed SITE_DECLARED (the marketplace-unique asset) — never a bare value,
 * so it satisfies the provenance gate (src/lib/metric.ts). A field the profile can't
 * answer degrades to an `unavailable` Metric (null value, LOW confidence), never a
 * fabricated blank.
 *
 * The core `resolveProfileField` is PURE (row in → Metric out); the Prisma binding is a
 * thin wrapper below, keeping the resolver offline-testable.
 */

import { Confidence, Provenance, siteDeclared, unavailable, type Metric } from "@/lib/metric";
import { normalize } from "../ingest";

/** The subset of InstitutionProfile the resolver reads (matches the Prisma model). */
export interface ProfileLike {
  legalName: string;
  address: string;
  email: string;
  phone: string;
  website: string;
  anonymizationLevel: string;
  lgpdBasis: string;
  ethicsCommittee: string;
  contractingDaysEst: number | null;
  acceptsEsignature: boolean;
  /** JSON string or parsed object: {data_dictionary:bool, flowchart:bool, ...}. */
  materials: string | Record<string, boolean>;
}

/** Stable profile field keys the A-resolver can answer. */
export type ProfileKey =
  | "institution_name"
  | "address"
  | "email"
  | "phone"
  | "website"
  | "anonymization_level"
  | "lgpd_basis"
  | "ethics_committee"
  | "contracting_days"
  | "accepts_esignature"
  | "has_data_dictionary";

/** Keyword rules mapping a PT-BR form label to a profile key (first hit wins). */
const LABEL_RULES: Array<{ re: RegExp; key: ProfileKey }> = [
  { re: /nome.*(institui|base)|razao social|institui/, key: "institution_name" },
  { re: /endereco|address/, key: "address" },
  { re: /e-?mail/, key: "email" },
  { re: /telefone|phone|contato/, key: "phone" },
  { re: /site|website|url/, key: "website" },
  { re: /anonimiz|pseudonimiz|identificav|anonimiza/, key: "anonymization_level" },
  { re: /lgpd|base legal|consentimento/, key: "lgpd_basis" },
  { re: /cep|conep|comite de etica|etica/, key: "ethics_committee" },
  { re: /contrata|negociac|prazo|assinatura/, key: "contracting_days" },
  { re: /assinatura digital|e-?signature|esign/, key: "accepts_esignature" },
  { re: /dicionario de dados|data dictionary|fluxograma|materia/, key: "has_data_dictionary" },
];

/** Map a raw form-field label to a profile key, or null if it isn't an A-profile field. */
export function profileKeyForLabel(label: string): ProfileKey | null {
  const n = normalize(label);
  // e-signature is more specific than the generic contracting rule; check it first.
  if (/assinatura digital|e-?signature|esign/.test(n)) return "accepts_esignature";
  for (const { re, key } of LABEL_RULES) if (re.test(n)) return key;
  return null;
}

function materialsObj(m: ProfileLike["materials"]): Record<string, boolean> {
  if (typeof m === "string") {
    try {
      return JSON.parse(m) as Record<string, boolean>;
    } catch {
      return {};
    }
  }
  return m;
}

/**
 * Resolve one profile field to a Metric. `asOf` is injected (the profile's updatedAt
 * ISO string) so the resolver stays clock-free and reproducible.
 */
export function resolveProfileField(
  profile: ProfileLike,
  key: ProfileKey,
  asOf?: string | null,
): Metric<string | number | null> {
  const opts = { asOf: asOf ?? null };
  const metricKey = `profile.${key}`;
  switch (key) {
    case "institution_name":
      return siteDeclared(metricKey, profile.legalName || null, Confidence.HIGH, opts);
    case "address":
      return siteDeclared(metricKey, profile.address || null, Confidence.HIGH, opts);
    case "email":
      return siteDeclared(metricKey, profile.email || null, Confidence.HIGH, opts);
    case "phone":
      return siteDeclared(metricKey, profile.phone || null, Confidence.HIGH, opts);
    case "website":
      return siteDeclared(metricKey, profile.website || null, Confidence.HIGH, opts);
    case "anonymization_level":
      return siteDeclared(metricKey, profile.anonymizationLevel || null, Confidence.HIGH, opts);
    case "lgpd_basis":
      return siteDeclared(metricKey, profile.lgpdBasis || null, Confidence.MEDIUM, opts);
    case "ethics_committee":
      return siteDeclared(metricKey, profile.ethicsCommittee || null, Confidence.MEDIUM, opts);
    case "contracting_days":
      return profile.contractingDaysEst == null
        ? unavailable(metricKey, Provenance.SITE_DECLARED, "contracting estimate not on file", opts)
        : siteDeclared(metricKey, profile.contractingDaysEst, Confidence.MEDIUM, {
            ...opts,
            unit: "days",
          });
    case "accepts_esignature":
      return siteDeclared(metricKey, profile.acceptsEsignature ? "yes" : "no", Confidence.HIGH, opts);
    case "has_data_dictionary":
      return siteDeclared(
        metricKey,
        materialsObj(profile.materials).data_dictionary ? "yes" : "no",
        Confidence.HIGH,
        opts,
      );
  }
}

/**
 * Resolve directly from a form-field label. Returns an `unavailable` Metric when the
 * label doesn't map to any known profile field (so downstream still gets provenance).
 */
export function resolveProfileByLabel(
  profile: ProfileLike,
  label: string,
  asOf?: string | null,
): Metric<string | number | null> {
  const key = profileKeyForLabel(label);
  if (!key) {
    return unavailable(
      "profile.unmapped",
      Provenance.SITE_DECLARED,
      `no profile field maps to "${label}"`,
      { asOf: asOf ?? null },
    );
  }
  return resolveProfileField(profile, key, asOf);
}
