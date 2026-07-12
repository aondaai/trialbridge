/**
 * Node-runtime-only boot seeding, imported by src/instrumentation.ts exclusively
 * inside its `NEXT_RUNTIME === "nodejs"` guard (so none of this — Prisma, the
 * autofill orchestrator, the Anthropic SDK it transitively imports — is ever
 * bundled for the Edge runtime that middleware.ts forces).
 *
 * Two independent demo baselines are seeded, each independently guarded and with
 * its failure logged and swallowed: one seed failing must not block the other,
 * and the server must always boot and serve (pages degrade to empty-state at worst).
 *   - seedDemo()            — the marketplace flow (/site respond + /sponsor board)
 *   - seedFeasibilityDemo() — the /site/feasibility multi-agent autofill demo run
 */
export async function seedAll(): Promise<void> {
  try {
    const { seedDemo } = await import("@/lib/seed/demo-seed");
    await seedDemo();
  } catch (err) {
    console.error("[instrumentation] marketplace seed failed (server continues):", err);
  }

  try {
    const { seedFeasibilityDemo } = await import("@/lib/seed/feasibility-demo-seed");
    await seedFeasibilityDemo();
  } catch (err) {
    console.error("[instrumentation] feasibility-demo seed failed (server continues):", err);
  }
}
