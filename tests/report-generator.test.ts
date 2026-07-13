import{describe,expect,it}from"vitest";
import{decisionLayerKind,pipelinesToTrigger}from"@/components/ReportGenerator";
import{newReportRun}from"@/lib/store";

describe("progressive report retries",()=>{
  it("retries every queued pipeline and the running CMA supply poll",()=>{
    const run=newReportRun("c1");
    run.pipelines=run.pipelines.map((pipeline)=>pipeline.key==="first-party-supply"?{...pipeline,status:"running"}:pipeline.key==="regulatory"?{...pipeline,status:"complete"}:pipeline);
    expect(pipelinesToTrigger(run)).toEqual([
      "first-party-supply","competitive-intensity","site-kol-discovery",
      "standard-of-care","representativeness","eligibility-realism",
    ]);
  });

  it("does not restart terminal pipelines",()=>{
    const run=newReportRun("c1");
    run.pipelines=run.pipelines.map((pipeline)=>({...pipeline,status:"complete"}));
    expect(pipelinesToTrigger(run)).toEqual([]);
  });
});

describe("decision layer",()=>{
  it("turns an observed candidate inventory into a validation recommendation without inventing a score",()=>{
    const run=newReportRun("c1");
    const supply=run.pipelines.find((pipeline)=>pipeline.key==="first-party-supply")!;
    expect(decisionLayerKind({...supply,status:"partial",result:{eligibilityFractionApplied:false,proprietaryFindingTotal:334}})).toBe("candidate-validation");
  });

  it("releases the evidence report for a legacy review-only result that omitted the eligibility flag",()=>{
    const run=newReportRun("c1");
    const supply=run.pipelines.find((pipeline)=>pipeline.key==="first-party-supply")!;
    expect(decisionLayerKind({...supply,status:"partial",result:{proprietaryFindingTotal:590}})).toBe("candidate-validation");
  });

  it("keeps a denominator-free zero signal pending",()=>{
    const run=newReportRun("c1");
    const supply=run.pipelines.find((pipeline)=>pipeline.key==="first-party-supply")!;
    expect(decisionLayerKind({...supply,status:"partial",result:{eligibilityFractionApplied:false,proprietaryFindingTotal:0}})).toBe("pending");
  });
});
