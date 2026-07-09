/**
 * Empty seed — the app starts with NO data.
 *
 * Per the /goal: zero patrocinadores, zero sites, zero consultations, zero
 * responses, zero pacientes. All records are created live by real users
 * (a site lists itself and uploads its patients; a sponsor posts a protocol).
 * This script only asserts the database is reachable and reports counts; it
 * inserts nothing. Run with `npm run db:seed`.
 */

import { prisma } from "../src/lib/db";

async function main() {
  const [sites, consultations, responses, patients] = await Promise.all([
    prisma.site.count(),
    prisma.consultation.count(),
    prisma.response.count(),
    prisma.patient.count(),
  ]);

  console.log("[seed] database reachable. Starting empty (no rows inserted).");
  console.log(
    `[seed] counts — sites=${sites} consultations=${consultations} responses=${responses} patients=${patients}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
