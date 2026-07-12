/**
 * Managed-Agents session (ADR-002 integration B) — run the Feasibility orchestrator on MCA cloud.
 *
 * Uses the REAL Managed Agents SDK surface (client.beta.environments / agents / sessions / events),
 * verified against a live account by scripts/mca-smoke.ts. The residency split holds: the agent runs
 * in an MCA CLOUD environment, and archetype C reaches patient data only through the site-side
 * cohort.preview MCP server exposed at `cohortTunnelUrl` — an MCP tunnel URL. Patient rows never enter
 * the cloud; the agent receives aggregates only.
 *
 * Gated: every call needs ANTHROPIC_API_KEY (the SDK client throws without it). The one remaining
 * external requirement is the MCP-tunnel preview + a publicly reachable site cohort.preview server
 * (run scripts/mcp-cohort-server.ts behind a tunnel) so `cohortTunnelUrl` resolves.
 */

import Anthropic from "@anthropic-ai/sdk";
import { FEASIBILITY_AGENT, COHORT_MCP_SERVER } from "./agentConfig";

const BETA = "managed-agents-2026-04-01";
const betas = [BETA] as unknown as Anthropic.Beta.AnthropicBeta[];

/** Create a cloud environment for the agent to run in. Returns its id. */
export async function createFeasibilityEnvironment(client: Anthropic, name = "trialbridge-feasibility"): Promise<string> {
  const env = await client.beta.environments.create({ name, config: { type: "cloud" }, betas });
  return env.id;
}

/**
 * Register the Feasibility Autofill agent, wired to the site's cohort.preview MCP tool over a tunnel.
 * A/B/D orchestration is carried by the agent's system prompt; C is the one model-callable MCP tool
 * (aggregates only). Returns the agent id.
 */
export async function createFeasibilityAgent(client: Anthropic, cohortTunnelUrl?: string): Promise<string> {
  // With a tunnel, C is a live MCP tool call; without one, C is pre-computed site-side and passed
  // to the agent as aggregate context (same residency guarantee — patient rows never reach cloud).
  const agent = await client.beta.agents.create({
    model: FEASIBILITY_AGENT.model,
    name: "trialbridge-feasibility",
    system: FEASIBILITY_AGENT.systemPrompt,
    ...(cohortTunnelUrl ? { mcp_servers: [{ type: "url" as const, name: COHORT_MCP_SERVER, url: cohortTunnelUrl }] } : {}),
    metadata: FEASIBILITY_AGENT.metadata,
    betas,
  });
  return agent.id;
}

/** Start a session for an agent in an environment. Returns the session id. */
export async function startSession(client: Anthropic, agentId: string, environmentId: string): Promise<string> {
  const session = await client.beta.sessions.create({ agent: agentId, environment_id: environmentId, betas });
  return session.id;
}

/** Send the study + parsed form to the session as a user message. */
export async function sendStudy(client: Anthropic, sessionId: string, userText: string): Promise<void> {
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.message", content: [{ type: "text", text: userText }] }],
    betas,
  });
}

/** Poll the session's events for the agent's assembled reply (aggregates only). */
export async function readReply(client: Anthropic, sessionId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let reply = "";
  while (Date.now() < deadline && !reply) {
    await new Promise((r) => setTimeout(r, 3000));
    const page = await client.beta.sessions.events.list(sessionId, { betas });
    for (const ev of page.getPaginatedItems()) {
      const e = ev as { type?: string; content?: Array<{ text?: string }> | { text?: string } };
      if (e.type === "agent.message") {
        const c = e.content;
        reply += Array.isArray(c) ? c.map((b) => b.text ?? "").join("") : c?.text ?? "";
      }
    }
  }
  return reply.trim();
}

export interface ManagedAutofillResult {
  environmentId: string;
  agentId: string;
  sessionId: string;
  reply: string;
}

/**
 * End-to-end: cloud env → agent (wired to the site cohort.preview tunnel) → session → send the
 * study → read the reply. THROWS without a key. Requires the MCP-tunnel preview + a reachable
 * `cohortTunnelUrl`. Caller is responsible for teardown (sessions.delete / environments.delete).
 */
export async function runManagedAutofill(params: {
  cohortTunnelUrl: string;
  userText: string;
  client?: Anthropic;
}): Promise<ManagedAutofillResult> {
  const client = params.client ?? new Anthropic();
  const environmentId = await createFeasibilityEnvironment(client);
  const agentId = await createFeasibilityAgent(client, params.cohortTunnelUrl);
  const sessionId = await startSession(client, agentId, environmentId);
  await sendStudy(client, sessionId, params.userText);
  const reply = await readReply(client, sessionId);
  return { environmentId, agentId, sessionId, reply };
}
