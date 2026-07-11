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

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

export interface McpClientOptions {
  env?: NodeJS.ProcessEnv;
  /** Per-request timeout (ms). A live-but-silent server rejects instead of hanging forever. */
  requestTimeoutMs?: number;
}

export class McpStdioClient {
  private proc: ChildProcess;
  private rl: Interface;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private readonly timeoutMs: number;

  constructor(command: string, args: string[], opts: McpClientOptions = {}) {
    this.timeoutMs = opts.requestTimeoutMs ?? 60_000;
    // detached: the child is its own process-group leader, so close() can group-kill it (and
    // any grandchild the tsx shim spawns). stderr → inherit: the child writes to our real
    // stderr fd, so a full pipe buffer can never deadlock the child (a real hang mode).
    this.proc = spawn(command, args, { env: opts.env ?? process.env, stdio: ["pipe", "pipe", "inherit"], detached: true });
    this.rl = createInterface({ input: this.proc.stdout!, terminal: false });
    this.rl.on("line", (line) => this.onLine(line));
    // Writing to a dead child's stdin emits 'error' (EPIPE) — swallow it here so it can't
    // crash the process; the in-flight request is rejected by its own write callback / timeout.
    this.proc.stdin!.on("error", () => {});
    this.proc.on("exit", () => {
      this.closed = true;
      this.failAll(new Error("mcp server exited"));
    });
    this.proc.on("error", (e) => {
      this.closed = true;
      this.failAll(e);
    });
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
    if (this.closed) return Promise.reject(new Error("mcp client closed"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`mcp request "${method}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      // Wrap so any settle path clears the timer (prevents a dangling timer keeping the loop alive).
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin!.write(payload, (err) => {
        if (err) {
          const p = this.pending.get(id);
          if (p) { this.pending.delete(id); p.reject(err); } // reject in-flight on EPIPE etc.
        }
      });
    });
  }

  /** MCP handshake. Call once before tool calls. */
  async initialize(): Promise<void> {
    await this.send("initialize");
    // Fire-and-forget the initialized notification (no id → no response expected).
    try {
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    } catch {
      /* stdin may already be gone — the handshake response already succeeded, so ignore. */
    }
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
    this.failAll(new Error("mcp client closed")); // synchronously reject anything in flight
    this.rl.close();
    try { this.proc.stdin!.end(); } catch { /* already closed */ }
    // Kill the whole process group (detached leader) so the tsx shim + its grandchild die too.
    const pid = this.proc.pid;
    if (pid) {
      try { process.kill(-pid, "SIGTERM"); } catch { try { this.proc.kill("SIGTERM"); } catch { /* gone */ } }
    }
  }
}
