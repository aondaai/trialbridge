/**
 * End-to-end persistence smoke test (proof for the /goal).
 *
 * Proves, against the REAL database (prisma/dev.db), that:
 *   1. the app boots empty — every table count is 0;
 *   2. a write actually lands and reads back — insert one Consultation, re-read
 *      it by id, then delete it so the app is left empty again.
 *
 * Run: npm run smoke   (./node_modules/.bin/tsx scripts/smoke.ts)
 */

import { prisma } from "../src/lib/db";

async function counts() {
  const [sites, consultations, responses, patients] = await Promise.all([
    prisma.site.count(),
    prisma.consultation.count(),
    prisma.response.count(),
    prisma.patient.count(),
  ]);
  return { sites, consultations, responses, patients };
}

async function main() {
  const boot = await counts();
  console.log("[smoke] boot counts:", JSON.stringify(boot));
  const empty = Object.values(boot).every((n) => n === 0);
  console.log(`[smoke] app starts empty: ${empty ? "YES ✓" : "NO ✗"}`);
  if (!empty) throw new Error("expected all counts to be 0 at boot");

  const id = "smoke-consultation";
  await prisma.consultation.create({
    data: {
      id,
      sponsorName: "Smoke Sponsor",
      title: "Smoke test protocol",
      protocolText: "n/a",
      criteria: "[]",
    },
  });
  const readBack = await prisma.consultation.findUnique({ where: { id } });
  console.log("[smoke] wrote + re-read consultation:", readBack?.id, "→ title:", readBack?.title);
  if (!readBack) throw new Error("write did not persist");

  await prisma.consultation.delete({ where: { id } });
  const after = await counts();
  console.log("[smoke] after cleanup:", JSON.stringify(after));
  console.log("[smoke] PASS — DB is writable and left empty ✓");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[smoke] FAIL:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
