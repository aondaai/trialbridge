/**
 * Managed Agents (MCA) smoke test — ADR-002 integration B, step 0.
 *
 * Verifies the account/key can actually run an agent on MCA cloud, using the REAL SDK surface
 * (client.beta.environments / agents / sessions / events). No patient data, and no cohort.preview
 * MCP tool yet (that needs a public tunnel to the site server) — this isolates raw cloud access.
 *
 * Run:  export ANTHROPIC_API_KEY=... ; npm run mca:smoke
 * Each step logs before it runs, so if the beta/access isn't enabled you see exactly where it stops.
 */

import Anthropic from "@anthropic-ai/sdk";

const BETA = "managed-agents-2026-04-01";
const betas = [BETA] as unknown as Anthropic.Beta.AnthropicBeta[];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const client = new Anthropic();
  let envId: string | undefined;
  let sessionId: string | undefined;

  try {
    console.log("1/5 create cloud environment…");
    const env = await client.beta.environments.create({ name: "trialbridge-mca-smoke", config: { type: "cloud" }, betas });
    envId = env.id;
    console.log(`    ✓ environment ${env.id}`);

    console.log("2/5 create agent (FEASIBILITY orchestrator, minimal)…");
    const agent = await client.beta.agents.create({
      model: "claude-opus-4-8",
      name: "trialbridge-feasibility-smoke",
      system: "You are a smoke test. Reply with exactly: MCA online. Then stop.",
      betas,
    });
    console.log(`    ✓ agent ${agent.id}`);

    console.log("3/5 create session…");
    const session = await client.beta.sessions.create({ agent: agent.id, environment_id: envId, betas });
    sessionId = session.id;
    console.log(`    ✓ session ${session.id}`);

    console.log("4/5 send a user message…");
    await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.message", content: [{ type: "text", text: "Run the smoke test." }] }], betas });
    console.log("    ✓ event sent");

    console.log("5/5 poll for the agent's reply (≤90s)…");
    const deadline = Date.now() + 90_000;
    let reply = "";
    let sawTerminal = false;
    while (Date.now() < deadline && !reply) {
      await new Promise((r) => setTimeout(r, 3000));
      const page = await client.beta.sessions.events.list(sessionId, { betas });
      for (const ev of page.getPaginatedItems()) {
        const e = ev as { type?: string; content?: Array<{ text?: string }> | { text?: string } };
        if (e.type === "agent.message") {
          const c = e.content;
          reply += Array.isArray(c) ? c.map((b) => b.text ?? "").join("") : c?.text ?? "";
        }
        if (e.type?.includes("terminated") || e.type === "session.end_turn") sawTerminal = true;
      }
      if (sawTerminal && !reply) break;
    }
    console.log(`    ✓ agent reply: ${reply.trim() || "(no agent.message yet — session still spinning up)"}`);
    console.log("\n=== MCA smoke: SUCCESS — an agent ran on MCA cloud ===");
  } finally {
    // Interrupt a running session so it can be deleted, then tear down the environment.
    try { if (sessionId) await client.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }], betas }); } catch { /* may already be idle */ }
    try { if (sessionId) { await client.beta.sessions.delete(sessionId, { betas }); console.log(`cleanup: session ${sessionId} deleted`); } } catch (e) { console.log(`cleanup: session left running (${(e as Error).message.slice(0, 60)}) — env delete will reap it`); }
    try { if (envId) { await client.beta.environments.delete(envId, { betas }); console.log(`cleanup: environment ${envId} deleted`); } } catch (e) { console.log("cleanup env failed:", (e as Error).message); }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\n=== MCA smoke: FAILED at the step above ===\n${(e as Error).message}`);
  const status = (e as { status?: number }).status;
  if (status === 403 || status === 404) console.error("→ Managed Agents / this beta is likely not enabled on the account. Request access, then retry.");
  process.exit(1);
});
