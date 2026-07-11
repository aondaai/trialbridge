/**
 * Deep web search pipe — a thin, reusable layer over the Parallel Task API client.
 *
 * `deepSearch` runs one structured research query. `deepSearchMany` is the "parallel
 * web services search pipe": it fans a list of subjects out across the Task API with
 * a bounded concurrency (so we can enrich 25 investigators without opening 25 sockets
 * at once), preserving input order and never rejecting — a failed item comes back as
 * an `unavailable` TaskResult, not a thrown error.
 */

import { runTask, TaskResult, RunTaskOptions, Processor } from "@/lib/parallel/client";

export interface DeepSearchOptions extends Partial<Omit<RunTaskOptions, "outputSchema">> {
  processor?: Processor;
}

/** One structured deep-research query against the web. */
export async function deepSearch(
  input: string | object,
  outputSchema: object,
  opts: DeepSearchOptions = {},
): Promise<TaskResult> {
  return runTask(input, { ...opts, outputSchema });
}

/** Bounded-concurrency map — the parallel pipe. Order-preserving; never rejects. */
export async function pooledMap<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  async function run(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, run));
  return results;
}

/**
 * Run the same output schema over many inputs, concurrently. Each subject yields a
 * `TaskResult` (its own citations/basis); a failure degrades that one item to
 * `unavailable` without sinking the batch.
 */
export async function deepSearchMany(
  inputs: (string | object)[],
  outputSchema: object,
  opts: DeepSearchOptions & { concurrency?: number } = {},
): Promise<TaskResult[]> {
  const { concurrency = 4, ...rest } = opts;
  return pooledMap(inputs, (input) => deepSearch(input, outputSchema, rest), concurrency);
}
