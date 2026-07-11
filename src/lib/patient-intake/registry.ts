import type { MapTarget, PatientIntakeResult, PatientSourceAdapter, PatientSourceInput } from "./types";

export class PatientRegistry {
  private adapters: PatientSourceAdapter[] = [];
  register(a: PatientSourceAdapter): this { this.adapters.push(a); return this; }
  /** Structure an input with the highest-scoring adapter; throws if none claims it. */
  async structure(input: PatientSourceInput, override?: Record<string, MapTarget>): Promise<PatientIntakeResult> {
    let best: PatientSourceAdapter | null = null;
    let bestScore = 0;
    for (const a of this.adapters) {
      const s = a.detect(input);
      if (s > bestScore) { best = a; bestScore = s; }
    }
    if (!best) throw new Error("patient-intake: no adapter recognized this input");
    return best.extract(input, override);
  }
}
