/**
 * Managed-Agents agent definition (ADR-002, phase M1) — how the orchestrator wires into MCA.
 *
 * This is the declarative shape passed to the Managed Agents "create agent" API: the model,
 * system prompt, and the tools the cloud orchestrator may call. The single MCP tool is
 * `cohort.preview`, served by the site-side server (mcp/cohortServer.ts) — the ONLY channel
 * that reaches patient data, and it returns aggregates only. A/B/D are executed by the
 * orchestrator's own code (orchestrator.ts); they are not model-called tools, which keeps the
 * deterministic ~80% pure and auditable (ADR-002: "A/B are tools, not agents").
 *
 * Exported as a typed constant (not sent from here) so it can be reviewed, versioned, and
 * asserted in tests without a live API key.
 */

export interface McaMcpToolRef {
  type: "mcp";
  /** The MCP server this tool lives on (the site-side cohort server). */
  server: string;
  name: string;
}

export interface McaAgentDefinition {
  model: string;
  systemPrompt: string;
  tools: McaMcpToolRef[];
  /** Non-secret metadata for the agent registry. */
  metadata: Record<string, string>;
}

export const COHORT_MCP_SERVER = "trialbridge-cohort";

export const FEASIBILITY_AGENT: McaAgentDefinition = {
  model: "claude-opus-4-8",
  systemPrompt: [
    "You orchestrate autofill of a clinical-trial site feasibility form. Route each field to one",
    "of four archetypes and assemble a provenanced answer for HUMAN REVIEW.",
    "",
    "Hard rules (never violate):",
    "- A (institution profile) and B (capability catalog) are DETERMINISTIC lookups. Use the values",
    "  the orchestrator computes; do not invent or reword them.",
    "- C (patient counts) come ONLY from the cohort.preview MCP tool, which returns AGGREGATES ONLY",
    "  (candidate N, per-criterion deltas, suppression). You never see patient rows and must never",
    "  ask for them.",
    "- D (narrative) is a DRAFT for a human. It is always status 'proposed'. You cannot approve,",
    "  render, or submit anything. A coordinator approves.",
    "- Every surfaced value is a provenanced Metric. If a value has no source, mark it unavailable —",
    "  never fabricate one.",
  ].join("\n"),
  tools: [{ type: "mcp", server: COHORT_MCP_SERVER, name: "cohort.preview" }],
  metadata: {
    module: "feasibility-autofill",
    adr: "ADR-002",
    phase: "M1",
    residency: "C runs site-side over MCP; A/B/D orchestrated cloud-side; no patient data in cloud",
  },
};
