import { describe, it, expect, afterEach } from "vitest";
import { McpStdioClient } from "@/lib/feasibility-autofill/mcp/mcpStdioClient";

/**
 * End-to-end round-trip against the REAL cohort.preview server subprocess. This needs NO API key
 * (archetype C is deterministic), so it verifies the live MCP client↔server seam offline.
 */
let client: McpStdioClient | null = null;
afterEach(() => {
  client?.close();
  client = null;
});

describe("live seam · MCP stdio client ↔ cohort.preview server", () => {
  it("initializes and lists/calls the tool over a spawned subprocess", async () => {
    client = new McpStdioClient("./node_modules/.bin/tsx", ["scripts/mcp-cohort-server.ts"]);
    await client.initialize();

    // Unknown site → the server returns an isError tool result → client throws a clean error.
    await expect(
      client.callTool("cohort.preview", {
        siteId: "does-not-exist",
        criteria: [{ kind: "inclusion", field: "age", operator: "gte", value: 18, rawText: "≥18" }],
      }),
    ).rejects.toThrow(/unknown site/);
  }, 30_000);

  it("surfaces a JSON-RPC error for an unknown tool", async () => {
    client = new McpStdioClient("./node_modules/.bin/tsx", ["scripts/mcp-cohort-server.ts"]);
    await client.initialize();
    await expect(client.callTool("nope.tool", {})).rejects.toThrow();
  }, 30_000);
});
