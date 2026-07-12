/**
 * Answer a real feasibility request via MCA cloud (ADR-002 integration B, no-tunnel variant).
 *
 * Loads a demo DB (site + patients), creates a FeasibilityRequest from a .docx, computes the
 * answers' SITE-SIDE AGGREGATES (profile facts, capability availability, cohort N via the matcher —
 * NO patient rows), and hands the study + form + aggregates to an MCA CLOUD agent, which assembles
 * the feasibility response and drafts the D narratives. A residency assertion guarantees no patient
 * id is in the cloud payload. Cleans up the cloud resources.
 *
 *   export ANTHROPIC_API_KEY=... ; npm run mca:autofill
 */

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../src/lib/db";
import { loadSite } from "../src/lib/data/sites";
import { makeDocx, escapeXml } from "../src/lib/feasibility-autofill/render/docx";
import { extractFormText, createFeasibilityRequest } from "../src/lib/feasibility-autofill/intakeRequest";
import { CANONICAL_SECTIONS } from "../src/lib/feasibility-autofill/canonicalTemplate";
import { resolveCohort, toCohortPreview } from "../src/lib/feasibility-autofill/resolvers/cohort";
import { createFeasibilityEnvironment, createFeasibilityAgent, startSession, sendStudy, readReply } from "../src/lib/feasibility-autofill/mcp/managedSession";
import type { Criterion, Patient } from "../src/lib/matcher/types";

const SITE = "site-mca-demo";
const PIDS = ["mp0", "mp1", "mp2", "mp3", "mp4", "mp5", "mp6"];
const CRITERIA: Criterion[] = [
  { id: "c1", kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "Idade ≥ 18", confidence: 1 },
  { id: "c2", kind: "inclusion", field: "diagnosis", operator: "eq", value: "breast", rawText: "Câncer de mama", confidence: 1 },
];

function pt(id: string, age: number, dx: string): Patient {
  return { id, siteId: SITE, diagnosis: dx, stage: null, biomarkers: {}, priorLines: null, ecog: null, labs: {}, sex: null, age };
}

async function ensureDb() {
  await prisma.site.upsert({ where: { id: SITE }, update: {}, create: { id: SITE, name: "iHealth (MCA demo)", country: "Brazil", city: "São Paulo", region: "Sudeste", persona: "site", monthlyIncidence: 6 } });
  await prisma.patient.deleteMany({ where: { siteId: SITE } });
  const rows = PIDS.map((id, i) => pt(id, 42 + i * 5, i < 6 ? "breast" : "lung"));
  await prisma.patient.createMany({ data: rows.map((p) => ({ id: p.id, siteId: SITE, data: JSON.stringify(p) })) });
  await prisma.institutionProfile.upsert({ where: { id: `${SITE}-profile` }, update: {}, create: { id: `${SITE}-profile`, siteId: SITE, legalName: "iHealth (MCA demo)", anonymizationLevel: "pseudonymized", lgpdBasis: "consentimento", acceptsEsignature: true, materials: JSON.stringify({ data_dictionary: true }) } });
  for (const c of [{ id: "ibd", av: "yes", m: "NLP+assertion" }, { id: "age", av: "yes", m: "birthdate" }, { id: "dyslipidemia", av: "partial", m: "CID-10" }]) {
    await prisma.capabilityCatalog.upsert({ where: { dataSourceId_conceptId: { dataSourceId: `${SITE}-ds`, conceptId: c.id } }, update: {}, create: { siteId: SITE, dataSourceId: `${SITE}-ds`, conceptId: c.id, available: c.av, identificationMethod: c.m, completenessQual: "high" } });
  }
}

function formDocx(): Uint8Array {
  const body = CANONICAL_SECTIONS.map((s) => `<w:p><w:r><w:t>${s.idx}. ${escapeXml(s.name)}</w:t></w:r></w:p>`).join("");
  return makeDocx(body);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  await ensureDb();

  // US-1: create the request from a .docx.
  const text = extractFormText("MSD_form.docx", formDocx());
  const { requestId } = await createFeasibilityRequest({ text, filename: "MSD_HER2_MBC.docx", siteId: SITE, sponsorId: "MSD" });
  await prisma.feasibilityRequest.update({ where: { id: requestId }, data: { criteria: JSON.stringify(CRITERIA), therapeuticArea: "Oncologia" } });

  // SITE-SIDE AGGREGATES (no patient rows leave this process).
  const ds = await loadSite(SITE);
  const cohort = toCohortPreview(resolveCohort(ds!.patients, CRITERIA, "2026-07-11T00:00:00Z"));
  const profile = await prisma.institutionProfile.findFirst({ where: { siteId: SITE } });
  const caps = await prisma.capabilityCatalog.findMany({ where: { siteId: SITE } });

  const payload = [
    "Monte a resposta de feasibility deste estudo. Regras: para A (perfil) e B (capacidade) use os valores agregados fornecidos, com proveniência 'site-declared'; C (contagem) use o N agregado fornecido (proveniência 'modeled', <5 suprimido); D (narrativa) redija um rascunho fundamentado — D é sempre PROPOSTA para revisão humana, nunca aprovada. Não invente contagens nem cite pacientes individuais.",
    "",
    "ESTUDO: HER2+ MBC — viabilidade. Patrocinador: MSD. Área: Oncologia.",
    `CRITÉRIOS: idade ≥ 18; diagnóstico = câncer de mama.`,
    "",
    "AGREGADOS DO SITE (sem dados de pacientes):",
    `- Perfil: ${profile?.legalName}; anonimização ${profile?.anonymizationLevel}; assinatura digital ${profile?.acceptsEsignature ? "sim" : "não"}.`,
    `- Capacidades: ${caps.map((c) => `${c.conceptId}=${c.available}`).join(", ")}.`,
    `- Coorte (AGREGADA, <5 suprimido): ${cohort.n} pacientes candidatos.`,
    "",
    "FORMULÁRIO — seções canônicas:",
    ...CANONICAL_SECTIONS.map((s) => `  ${s.idx}. ${s.name} [${s.archetype}]`),
    "",
    "Responda em português, uma linha por seção, no formato: 'N. Seção — [arquétipo] valor/rascunho (proveniência)'.",
  ].join("\n");

  // Residency guard: assert no patient id is in the cloud payload.
  for (const id of PIDS) if (payload.includes(id)) throw new Error(`RESIDENCY VIOLATION: patient id ${id} in cloud payload`);
  console.log(`[mca-autofill] request ${requestId} · cohort N=${cohort.n} · payload ${payload.length} chars · no patient id ✓`);

  // Run it on MCA cloud.
  const client = new Anthropic();
  let envId: string | undefined, sessionId: string | undefined;
  try {
    console.log("[mca-autofill] creating cloud environment + agent + session…");
    envId = await createFeasibilityEnvironment(client, "trialbridge-mca-autofill");
    const agentId = await createFeasibilityAgent(client); // no tunnel — C passed as context
    sessionId = await startSession(client, agentId, envId);
    console.log(`[mca-autofill] env ${envId} · agent ${agentId} · session ${sessionId}`);
    await sendStudy(client, sessionId, payload);
    console.log("[mca-autofill] sent study to cloud agent; awaiting assembled answer…");
    const reply = await readReply(client, sessionId, 150_000);
    console.log("\n===== MCA cloud agent — assembled feasibility answer =====\n");
    console.log(reply || "(no reply captured within timeout)");
    console.log("\n=========================================================");
  } finally {
    try { if (sessionId) await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }], betas: ["managed-agents-2026-04-01"] as never }); } catch { /* idle */ }
    try { if (sessionId) await client.beta.sessions.delete(sessionId, { betas: ["managed-agents-2026-04-01"] as never }); } catch { /* still running */ }
    try { if (envId) { await client.beta.environments.delete(envId, { betas: ["managed-agents-2026-04-01"] as never }); console.log("cleanup: environment deleted"); } } catch { /* */ }
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error("[mca-autofill] failed:", (e as Error).message); await prisma.$disconnect(); process.exit(1); });
