import { createInterface } from "node:readline";
import { runSiteShortlist, SITE_SHORTLIST_TOOL, type ConsultationLoader, type SiteShortlistRequest, type SiteShortlistResult } from "./siteShortlistTool";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "trialbridge-site-selection", version: "0.1.0" };

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type SelectionRunner = (request: SiteShortlistRequest, loader: ConsultationLoader) => Promise<SiteShortlistResult>;

export async function dispatchSelection(req: JsonRpcRequest, loadConsultation: ConsultationLoader, runner: SelectionRunner = runSiteShortlist) {
  if (typeof req !== "object" || req === null || typeof req.method !== "string") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  }
  const id = req.id ?? null;
  if (req.method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
  if (req.method === "notifications/initialized") return null;
  if (req.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: [SITE_SHORTLIST_TOOL] } };
  if (req.method !== "tools/call") return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${req.method}` } };
  const params = req.params ?? {};
  if (params.name !== SITE_SHORTLIST_TOOL.name) return { jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool "${String(params.name)}"` } };
  try {
    const args = (params.arguments ?? {}) as { consultationId?: string; limit?: number };
    const result = await runner({ consultationId: args.consultationId ?? "", limit: args.limit }, loadConsultation);
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false } };
  } catch (error) {
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `site.shortlist error: ${(error as Error).message}` }], isError: true } };
  }
}

export function serveSelection(loadConsultation: ConsultationLoader): void {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req: JsonRpcRequest;
    try { req = JSON.parse(line) as JsonRpcRequest; }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n"); return; }
    void dispatchSelection(req, loadConsultation).then((response) => {
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    });
  });
}
