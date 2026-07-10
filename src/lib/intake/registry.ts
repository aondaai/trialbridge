/**
 * The adapter registry — the one place that turns "some input" into an
 * `IntakeResult`. Adapters register here; `ingest` picks the highest `detect`
 * scorer and runs it. Keeping selection here (not inside each adapter) means a
 * new format is one `register()` call away and detection stays comparable.
 */

import type { IntakeInput, IntakeResult, SourceAdapter } from "./types";

export class IntakeRegistry {
  private adapters: SourceAdapter[] = [];

  register(adapter: SourceAdapter): this {
    if (this.adapters.some((a) => a.id === adapter.id)) {
      throw new Error(`intake: adapter "${adapter.id}" already registered`);
    }
    this.adapters.push(adapter);
    return this;
  }

  list(): readonly SourceAdapter[] {
    return this.adapters;
  }

  /** Highest-scoring adapter for this input, or null if none claims it (>0). */
  detectBest(input: IntakeInput): { adapter: SourceAdapter; score: number } | null {
    let best: { adapter: SourceAdapter; score: number } | null = null;
    for (const adapter of this.adapters) {
      const score = clamp01(adapter.detect(input));
      if (score > 0 && (best === null || score > best.score)) {
        best = { adapter, score };
      }
    }
    return best;
  }

  /** Detect + extract. Throws a clear error when nothing claims the input. */
  async ingest(input: IntakeInput): Promise<IntakeResult> {
    const best = this.detectBest(input);
    if (!best) {
      throw new Error(
        `intake: no adapter recognized this ${input.kind} input (registered: ${this.adapters
          .map((a) => a.id)
          .join(", ")})`,
      );
    }
    return best.adapter.extract(input);
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
