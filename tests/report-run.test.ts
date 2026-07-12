import { describe, expect, it } from "vitest";
import { newReportRun } from "@/lib/store";

describe("progressive feasibility report run",()=>{
  it("creates one queued pipeline for supply and each research dimension",()=>{
    const run=newReportRun("consultation-1","2026-07-12T00:00:00.000Z");
    expect(run.schemaVersion).toBe("report-run.v1");
    expect(run.status).toBe("queued");
    expect(run.pipelines.map((pipeline)=>pipeline.key)).toEqual([
      "first-party-supply",
      "regulatory",
      "competitive-intensity",
      "site-kol-discovery",
      "standard-of-care",
      "representativeness",
      "eligibility-realism",
    ]);
    expect(run.pipelines.every((pipeline)=>pipeline.status==="queued")).toBe(true);
  });
});
