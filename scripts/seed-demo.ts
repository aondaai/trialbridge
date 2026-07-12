/**
 * CLI entry point for the demo baseline seed (`npm run db:seed-demo`).
 *
 * The actual seeding logic lives in src/lib/seed/demo-seed.ts so it can be shared
 * with the Next.js server-boot hook (src/instrumentation.ts), which is what seeds
 * the Render instance on each deploy. This script is for local/manual runs.
 */

import { seedDemo } from "../src/lib/seed/demo-seed";

seedDemo()
  .then(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[seed-demo] failed:", e);
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
    process.exit(1);
  });
