/**
 * `cohort.preview` MCP server (ADR-002, phase M0) — dependency-free stdio JSON-RPC.
 *
 * Runs on the SITE's own infrastructure and exposes exactly one tool, `cohort.preview`,
 * over the MCP stdio transport (newline-delimited JSON-RPC 2.0). An MCA cloud orchestrator
 * connects to this and receives aggregates only; patient rows stay behind this process.
 *
 * Dependency-free by design (matches the repo's hand-rolled zip/docx primitives): the MCP
 * wire format is small enough to implement directly, and avoids adding an SDK to the one
 * component that must run inside the site boundary. `dispatch` is exported for unit tests;
 * `serve` wires it to stdin/stdout.
 */

import { createInterface } from "node:readline";
import { runCohortPreview, COHORT_PREVIEW_TOOL, type PatientLoader } from "./cohortPreviewTool";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "trialbridge-cohort", version: "0.1.0" };

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

/**
 * Handle one JSON-RPC request. Returns a response, or `null` for notifications (no id →
 * nothing to reply). `loadPatients` is injected so the server (and tests) control data access.
 */
export async function dispatch(
  req: JsonRpcRequest,
  loadPatients: PatientLoader,
): Promise<JsonRpcResponse | null> {
  // `null` and non-objects are valid JSON but not valid requests — reject cleanly rather
  // than dereferencing (a bare `null\n` must not crash the site-boundary server).
  if (typeof req !== "object" || req === null || typeof (req as JsonRpcRequest).method !== "string") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };
    case "notifications/initialized":
      return null; // notification — no reply
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: [COHORT_PREVIEW_TOOL] } };
    case "tools/call": {
      const params = req.params ?? {};
      const name = params.name as string;
      if (name !== COHORT_PREVIEW_TOOL.name) {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool "${name}"` } };
      }
      const args = (params.arguments ?? {}) as { siteId?: string; criteria?: unknown };
      try {
        const preview = await runCohortPreview(
          { siteId: args.siteId ?? "", criteria: args.criteria as never },
          loadPatients,
        );
        // MCP tool result: text content + structured content. Aggregates only.
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(preview) }],
            structuredContent: preview,
            isError: false,
          },
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `cohort.preview error: ${(err as Error).message}` }],
            isError: true,
          },
        };
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${req.method}` } };
  }
}

/** Wire `dispatch` to stdin/stdout as a newline-delimited JSON-RPC loop. */
export function serve(loadPatients: PatientLoader): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n",
      );
      return;
    }
    void dispatch(req, loadPatients)
      .then((resp) => {
        if (resp) process.stdout.write(JSON.stringify(resp) + "\n");
      })
      .catch((err: unknown) => {
        // Never let a handler rejection take down the boundary server.
        const id = (req as { id?: string | number | null })?.id ?? null;
        process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: `internal error: ${(err as Error).message}` } }) + "\n",
        );
      });
  });
}
