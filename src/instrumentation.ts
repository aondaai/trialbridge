/**
 * Next.js server-boot hook — runs ONCE when the server process starts (not at
 * build time, not per request). We use it to seed the demo baseline so a fresh
 * Render deploy comes up with the two-sided flow ready.
 *
 * Why here and not the render.yaml startCommand: Render will not apply a changed
 * Blueprint start command to an existing service without a manual dashboard sync,
 * so a `git push` that edits the start command silently keeps running the old one
 * and the seed never executes. Seeding from this hook depends ONLY on application
 * code — which auto-deploys on every push — so the flow is populated on the next
 * deploy with no dashboard action and no runtime dependency on the tsx/prisma CLIs.
 * (The npm script still exists for local/manual seeding; both call seedDemo().)
 *
 * Guarded to the Node.js runtime: register() is invoked for every runtime
 * (including the Edge middleware), but Prisma only runs under Node, so we bail out
 * elsewhere and dynamic-import the seed to keep it out of the Edge bundle. A seed
 * failure is logged and swallowed — the app must still boot and serve.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { seedDemo } = await import("@/lib/seed/demo-seed");
    await seedDemo();
  } catch (err) {
    // Never let a seed problem take down the server; the pages degrade to their
    // empty-state fallbacks, which is strictly better than a boot crash.
    console.error("[instrumentation] demo seed failed (server continues):", err);
  }
}
