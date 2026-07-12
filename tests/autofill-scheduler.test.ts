import { describe, it, expect } from "vitest";
import {
  ageInDays,
  findStaleCapabilities,
  planNightlyJob,
  NEVER_VALIDATED_AGE,
  type CatalogRowLike,
} from "@/lib/feasibility-autofill/mcp/scheduler";

const NOW = "2026-07-11T00:00:00Z";

function row(conceptId: string, lastValidatedAt: string, completenessQual = "high"): CatalogRowLike {
  return { conceptId, dataSourceId: "ds1", siteId: "s1", lastValidatedAt, completenessQual };
}

describe("M4 · scheduled freshness planner", () => {
  it("ageInDays is clock-free and floors to whole days", () => {
    expect(ageInDays("2026-07-01T00:00:00Z", NOW)).toBe(10);
    expect(ageInDays("2026-07-11T00:00:00Z", NOW)).toBe(0);
    expect(ageInDays("not-a-date", NOW)).toBe(NEVER_VALIDATED_AGE); // finite, JSON-safe sentinel
    expect(Number.isFinite(ageInDays("not-a-date", NOW))).toBe(true);
  });

  it("flags rows past the 90-day window, most-stale first", () => {
    const rows = [
      row("fresh", "2026-06-20T00:00:00Z"), // 21d — fresh
      row("stale1", "2026-01-01T00:00:00Z"), // ~191d
      row("stale2", "2026-03-01T00:00:00Z"), // ~132d
    ];
    const tasks = findStaleCapabilities(rows, NOW);
    expect(tasks.map((t) => t.conceptId)).toEqual(["stale1", "stale2"]);
    expect(tasks[0].ageDays).toBeGreaterThan(tasks[1].ageDays);
  });

  it("revalidates low-completeness rows on half the window", () => {
    const rows = [row("low", "2026-05-01T00:00:00Z", "low")]; // ~71d ≥ 45d (half of 90)
    const tasks = findStaleCapabilities(rows, NOW);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].reason).toMatch(/≥ 45d/);
  });

  it("treats a never/unparseable-validated row as stale", () => {
    const tasks = findStaleCapabilities([row("x", "garbage")], NOW);
    expect(tasks[0].reason).toBe("never validated");
  });

  it("planNightlyJob bounds work and carries reindex + pre-match signals", () => {
    const many = Array.from({ length: 150 }, (_, i) => row(`c${i}`, "2020-01-01T00:00:00Z"));
    const job = planNightlyJob({ catalog: many, nowIso: NOW, ragDirty: true, newStudyIds: ["NCT01", "NCT02"], maxTasks: 100 });
    expect(job.revalidate).toHaveLength(100);
    expect(job.truncated).toBe(true);
    expect(job.reindexRag).toBe(true);
    expect(job.preMatchStudies).toEqual(["NCT01", "NCT02"]);
    expect(job.generatedAt).toBe(NOW); // clock-free
  });

  it("a fully-fresh catalog yields an empty, non-truncated job", () => {
    const job = planNightlyJob({ catalog: [row("f", "2026-07-10T00:00:00Z")], nowIso: NOW });
    expect(job.revalidate).toHaveLength(0);
    expect(job.truncated).toBe(false);
  });
});
