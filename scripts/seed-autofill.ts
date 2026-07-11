/**
 * Feasibility Autofill reference seed (F0-2).
 *
 * Loads the committed QuestionBank extract (seeds/questionbank.seed.json, produced
 * from DoctorAssistant_Feasibility_QuestionBank.xlsx) into SQLite:
 *   - FormTemplate       ← "Modelo Canônico" (16 canonical sections) — the A/B/C/D ground truth.
 *   - InstitutionProfile ← a demo iHealth/DII institution (archetype A source).
 *   - DataSource         ← the demo site's clinical NLP base.
 *   - CapabilityCatalog  ← "Catálogo de Capacidade" rows (archetype B repository).
 *
 * Idempotent: deterministic ids + upserts, safe to re-run. Distinct from the empty
 * main seed (prisma/seed.ts) — this seeds *reference* data (template + catalog), not
 * live marketplace rows. Run with `npm run db:seed-autofill`.
 *
 * NOTE (reconciliation gap): the catalog concepts are IBD/ASCVD (DII, LDL, IAM) while
 * the repo's concept-map.json is oncology-only. conceptId here is a stable slug; wiring
 * these to verified OMOP concept_ids is the ontology-extension work flagged in
 * docs/feasibility-autofill-reconciliation.md ("Two real gaps").
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/db";

const DEMO_SITE_ID = "site-ihealth-demo";
const DEMO_DS_ID = "ds-ihealth-nlp";

interface Seed {
  formTemplate: { fingerprint: string; name: string; structure: unknown };
  capabilityCatalog: Array<{
    conceptId: string;
    conceptLabel: string;
    available: string;
    identificationMethod: string;
    sourceField: string;
    completenessRaw: string;
    notes: string;
    placeholder: boolean;
  }>;
}

/** Map the workbook's free-text completude ("Alta" / ">99,9%" / "[…]") to (value?, qual). */
function completeness(raw: string): { value: number | null; qual: string } {
  const t = raw.toLowerCase();
  const pct = t.match(/([\d.,]+)\s*%/);
  const value = pct ? Number(pct[1].replace(".", "").replace(",", ".")) / 100 : null;
  let qual = "moderate";
  if (t.includes("alta") || (value !== null && value >= 0.9)) qual = "high";
  else if (t.includes("baixa")) qual = "low";
  else if (t.includes("m") && (t.includes("dia") || t.includes("moder"))) qual = "moderate";
  return { value: value !== null && value > 1 ? value / 100 : value, qual };
}

async function main() {
  const path = join(process.cwd(), "seeds", "questionbank.seed.json");
  const seed = JSON.parse(readFileSync(path, "utf8")) as Seed;

  // FormTemplate (cross-site, fingerprint-keyed).
  const ft = seed.formTemplate;
  await prisma.formTemplate.upsert({
    where: { fingerprint: ft.fingerprint },
    update: { name: ft.name, structure: JSON.stringify(ft.structure) },
    create: { fingerprint: ft.fingerprint, name: ft.name, structure: JSON.stringify(ft.structure) },
  });

  // Demo institution profile (archetype A).
  await prisma.institutionProfile.upsert({
    where: { id: DEMO_SITE_ID + "-profile" },
    update: {},
    create: {
      id: DEMO_SITE_ID + "-profile",
      siteId: DEMO_SITE_ID,
      legalName: "iHealth (demo) — Base de Texto Clínico",
      anonymizationLevel: "pseudonymized",
      lgpdBasis: "consentimento / interesse legítimo (demo)",
      acceptsEsignature: true,
      materials: JSON.stringify({ data_dictionary: true, flowchart: false }),
    },
  });

  // Demo data source.
  await prisma.dataSource.upsert({
    where: { id: DEMO_DS_ID },
    update: {},
    create: {
      id: DEMO_DS_ID,
      siteId: DEMO_SITE_ID,
      name: "iHealth clinical NLP base (demo)",
      kind: JSON.stringify(["emr", "nlp_text"]),
      coverageNote: "Texto clínico com NER + assertion detection.",
    },
  });

  // Capability catalog rows (archetype B).
  let n = 0;
  for (const row of seed.capabilityCatalog) {
    const { value, qual } = completeness(row.completenessRaw);
    await prisma.capabilityCatalog.upsert({
      where: { dataSourceId_conceptId: { dataSourceId: DEMO_DS_ID, conceptId: row.conceptId } },
      update: {
        available: row.available,
        identificationMethod: row.identificationMethod,
        sourceField: row.sourceField,
        completenessValue: value,
        completenessQual: qual,
        notes: row.notes,
      },
      create: {
        siteId: DEMO_SITE_ID,
        dataSourceId: DEMO_DS_ID,
        conceptId: row.conceptId,
        available: row.available,
        identificationMethod: row.identificationMethod,
        sourceField: row.sourceField,
        completenessValue: value,
        completenessQual: qual,
        notes: row.notes,
      },
    });
    n++;
  }

  const [templates, catalog] = await Promise.all([
    prisma.formTemplate.count(),
    prisma.capabilityCatalog.count(),
  ]);
  console.log(
    `[seed-autofill] ok — templates=${templates} catalogRows=${catalog} (seeded ${n} from QuestionBank)`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
