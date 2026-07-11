/**
 * Minimal MCP stdio client (ADR-002 live seam) — the cloud side of the residency boundary.
 *
 * Spawns the site-side `cohort.preview` MCP server as a subprocess and speaks newline-delimited
 * JSON-RPC to it (the same wire format cohortServer.ts serves). Dependency-free, matching the
 * server. This is what an orchestrator's `cohortPreview` dep uses to reach patient-count queries
 * that must stay behind the site boundary — it only ever receives aggregates.
 *
 * Robust to interleaving: requests are matched to responses by id; notifications (no id) and any
 * non-JSON stderr noise are ignored. Verifiable OFFLINE (the server needs no API key), which is
 * why the round-trip is unit-tested against the real subprocess.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams;
  private rl: Interface;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;

  constructor(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
    this.proc = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.rl = createInterface({ input: this.proc.stdout, terminal: false });
    this.rl.on("line", (line) => this.onLine(line));
    this.proc.on("exit", () => this.failAll(new Error("mcp server exited")));
    this.proc.on("error", (e) => this.failAll(e));
  }

  private onLine(line: string): void {
    const t = line.trim();
    if (!t) return;
    let msg: { id?: number; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(t);
    } catch {
      return; // ignore non-JSON (stderr echoes, banners)
    }
    if (msg.id == null) return; // notification — nothing to resolve
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("client closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(payload);
    });
  }

  /** MCP handshake. Call once before tool calls. */
  async initialize(): Promise<void> {
    await this.send("initialize");
    // Fire-and-forget the initialized notification (no id → no response expected).
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  /** Call a tool; returns the tool result's `structuredContent` (or `content`). */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = (await this.send("tools/call", { name, arguments: args })) as {
      structuredContent?: T;
      content?: Array<{ text: string }>;
      isError?: boolean;
    };
    if (result.isError) {
      throw new Error(result.content?.[0]?.text ?? `tool ${name} failed`);
    }
    if (result.structuredContent !== undefined) return result.structuredContent;
    // Fall back to parsing the text content.
    return JSON.parse(result.content?.[0]?.text ?? "null") as T;
  }

  close(): void {
    this.closed = true;
    this.rl.close();
    this.proc.stdin.end();
    this.proc.kill();
  }
}
