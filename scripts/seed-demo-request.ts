/**
 * CLI entry point for the feasibility-autofill demo seed (`npm run db:seed-demo-request`).
 *
 * The logic lives in src/lib/seed/feasibility-demo-seed.ts so it is shared with
 * the Next.js server-boot hook (src/instrumentation.ts → seedDemo), which seeds
 * the Render instance on each deploy. This script is for local/manual runs: it
 * seeds a request + demo patients, runs the multi-agent orchestrator in-process
 * (deterministic A/B/C + template D, no API key), and persists the answers so the
 * review workspace (/site/feasibility) renders a live run.
 */

import { seedFeasibilityDemo } from "../src/lib/seed/feasibility-demo-seed";

seedFeasibilityDemo()
  .then(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("[seed-demo-request] failed:", e);
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
    process.exit(1);
  });
