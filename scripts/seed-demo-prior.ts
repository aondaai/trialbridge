/**
 * Demo RAG memory seed — a couple of approved prior narrative answers for the demo site, so the
 * D (narrative) resolver has exemplars to ground a draft on. Optional; only for demos of the
 * full RAG→draft→critic loop. Idempotent (stable ids). Run: `npm run db:seed-demo-prior`.
 */

import { prisma } from "../src/lib/db";
import { indexApprovedNarrative } from "../src/lib/feasibility-autofill/learn";

const SITE = "site-ihealth-demo";
const APPROVED_AT = "2026-07-01T00:00:00Z"; // fixed (clock-free)

const PRIORS = [
  {
    section: "Desafios",
    label: "Principais desafios para a condução",
    answerText:
      "Os principais desafios são o volume de dados históricos anteriores a 2019 e a reconciliação de unidades laboratoriais entre fontes; a elegibilidade depende de NLP validado sobre texto clínico.",
  },
  {
    section: "Limitações Metodológicas",
    label: "Principais limitações da base",
    answerText:
      "A base cobre o período de 2019 a 2025; sazonalidade não é modelada e há subcaptura de desfechos ambulatoriais fora da rede.",
  },
];

async function main() {
  let n = 0;
  for (const p of PRIORS) {
    const rec = indexApprovedNarrative({ siteId: SITE, ...p, status: "approved" }, APPROVED_AT);
    if (!rec) continue;
    await prisma.priorFormAnswer.upsert({
      where: { id: rec.id },
      update: { answerText: rec.answerText, section: rec.section, label: rec.label },
      create: { id: rec.id, siteId: rec.siteId, section: rec.section, label: rec.label, conceptId: rec.conceptId ?? null, answerText: rec.answerText, approvedAt: new Date(rec.approvedAt) },
    });
    n++;
  }
  const total = await prisma.priorFormAnswer.count({ where: { siteId: SITE } });
  console.log(`[seed-demo-prior] ok — upserted ${n}; ${total} prior answers for ${SITE}`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
