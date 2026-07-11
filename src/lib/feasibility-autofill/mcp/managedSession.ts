/**
 * Managed-Agents session scaffold (ADR-002 live seam, integration "B") — CLOUD execution.
 *
 * SCAFFOLD — reconcile the exact request/response shapes against the current Managed Agents
 * API reference (managed-agents/reference) before relying on this. The endpoint paths, payload
 * fields, and SSE event shapes below follow the DOCUMENTED concepts (create agent -> create
 * session -> send events -> stream SSE) but the beta schema is authoritative. Lines tagged
 * "VERIFY:" are the ones most likely to differ from the live reference.
 *
 * This is the OTHER integration: instead of running the orchestrator in your Node process
 * (see liveDeps.ts, which needs only ANTHROPIC_API_KEY), you hand orchestration to MCA's managed
 * cloud. The managed Claude runs FEASIBILITY_AGENT and calls the site-side cohort.preview MCP
 * tool over an MCP tunnel. Requires MCA beta access on the account.
 *
 * Gated: throws unless ANTHROPIC_API_KEY is set. The SDK normally sets the beta header
 * automatically; this raw-fetch scaffold sets it explicitly so the requirement is visible.
 */

import { FEASIBILITY_AGENT, COHORT_MCP_SERVER } from "./agentConfig";

const API_BASE = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const BETA_HEADER = "managed-agents-2026-04-01";

function authHeaders(): Record<string, string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("managedSession: ANTHROPIC_API_KEY not set — refusing to call the MCA API");
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": BETA_HEADER,
  };
}

/** MCP-tunnel config so the managed agent can reach the site-side cohort.preview server. */
export interface McpTunnelConfig {
  /** Server name the agent references (matches agentConfig COHORT_MCP_SERVER). */
  name: string;
  /** The site-exposed MCP endpoint (an MCP tunnel URL; see agents-and-tools/mcp-tunnels). */
  url: string;
}

/**
 * Create (or upsert) the Feasibility Autofill agent. Returns the agent id.
 * VERIFY: path (POST /v1/agents) and body fields against the reference.
 */
export async function createAgent(tunnel: McpTunnelConfig): Promise<string> {
  const body = {
    model: FEASIBILITY_AGENT.model,
    system: FEASIBILITY_AGENT.systemPrompt, // VERIFY: field name (system vs system_prompt)
    mcp_servers: [{ name: tunnel.name, url: tunnel.url }], // VERIFY: mcp-server tool shape
    metadata: FEASIBILITY_AGENT.metadata,
  };
  const resp = await fetch(`${API_BASE}/v1/agents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`createAgent failed: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { id: string };
  return json.id;
}

/**
 * Start a session for an agent in an environment. Returns the session id.
 * VERIFY: path (POST /v1/agents/{agentId}/sessions) and env field (cloud vs self-hosted).
 */
export async function createSession(agentId: string, environmentId?: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/v1/agents/${agentId}/sessions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ environment_id: environmentId }),
  });
  if (!resp.ok) throw new Error(`createSession failed: ${resp.status} ${await resp.text()}`);
  const json = (await resp.json()) as { id: string };
  return json.id;
}

/**
 * Send a user event (the study + parsed fields) to a session. The managed agent then routes,
 * calls cohort.preview over the tunnel, drafts D, and streams results back via SSE.
 * VERIFY: path (POST /v1/sessions/{sessionId}/events) and event shape.
 */
export async function sendEvent(sessionId: string, userText: string): Promise<Response> {
  const resp = await fetch(`${API_BASE}/v1/sessions/${sessionId}/events`, {
    method: "POST",
    headers: { ...authHeaders(), accept: "text/event-stream" },
    body: JSON.stringify({ type: "user_message", content: userText }),
  });
  // Surface an HTTP error clearly instead of handing back an error body to be consumed as SSE.
  if (!resp.ok) throw new Error(`sendEvent failed: ${resp.status} ${await resp.text()}`);
  return resp;
}

/**
 * End-to-end convenience: create agent -> session -> send one event. Returns the streaming
 * Response for the caller to consume as SSE. THROWS without a key. Reconcile all shapes with
 * the live reference before use.
 */
export async function runManagedAutofill(params: {
  tunnel: McpTunnelConfig;
  userText: string;
  environmentId?: string;
}): Promise<{ agentId: string; sessionId: string; stream: Response }> {
  if (params.tunnel.name !== COHORT_MCP_SERVER) {
    throw new Error(`tunnel name must be "${COHORT_MCP_SERVER}" to match agentConfig`);
  }
  const agentId = await createAgent(params.tunnel);
  const sessionId = await createSession(agentId, params.environmentId);
  const stream = await sendEvent(sessionId, params.userText);
  return { agentId, sessionId, stream };
}
