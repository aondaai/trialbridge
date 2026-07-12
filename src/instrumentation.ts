/**
 * Next.js server-boot hook — runs ONCE when the server process starts (not at
 * build time, not per request). We use it to seed the demo baselines so a fresh
 * Render deploy comes up with Camila's flows ready.
 *
 * Why here and not the render.yaml startCommand: Render will not apply a changed
 * Blueprint start command to an existing service without a manual dashboard sync,
 * so a `git push` that edits the start command silently keeps running the old one
 * and the seed never executes. Seeding from this hook depends ONLY on application
 * code — which auto-deploys on every push — with no dependency on the tsx/prisma
 * CLIs at runtime.
 *
 * The actual seeding lives in ./instrumentation-node, imported ONLY inside the
 * `NEXT_RUNTIME === "nodejs"` guard. That exact pattern is recognised by the Next
 * bundler so the Node-only code (Prisma, and the autofill orchestrator which pulls
 * in the Anthropic SDK's node:fs/zlib) is kept OUT of the Edge bundle that
 * middleware.ts forces — otherwise the build fails on the `node:` scheme imports.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { seedAll } = await import("./instrumentation-node");
    await seedAll();
  }
}
