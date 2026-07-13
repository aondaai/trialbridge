import{beforeEach,describe,expect,it,vi}from"vitest";

const mocks=vi.hoisted(()=>({
  findUnique:vi.fn(),
  updateMany:vi.fn(),
}));

vi.mock("@/lib/db",()=>({prisma:{consultation:{findUnique:mocks.findUnique,updateMany:mocks.updateMany}}}));

import{newReportRun,updateReportPipeline}from"@/lib/store";

describe("report pipeline compare-and-swap",()=>{
  beforeEach(()=>vi.clearAllMocks());

  it("retries after a concurrent write and preserves the other pipeline",async()=>{
    const initial=newReportRun("c1","2026-07-13T00:00:00Z");
    const concurrent={...initial,pipelines:initial.pipelines.map((pipeline)=>
      pipeline.key==="competitive-intensity"?{...pipeline,status:"complete" as const}:pipeline)};
    mocks.findUnique
      .mockResolvedValueOnce({reportRun:JSON.stringify(initial)})
      .mockResolvedValueOnce({reportRun:JSON.stringify(concurrent)});
    mocks.updateMany
      .mockResolvedValueOnce({count:0})
      .mockResolvedValueOnce({count:1});

    const result=await updateReportPipeline("c1","regulatory",{status:"complete"});

    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(result.pipelines.find((pipeline)=>pipeline.key==="competitive-intensity")?.status).toBe("complete");
    expect(result.pipelines.find((pipeline)=>pipeline.key==="regulatory")?.status).toBe("complete");
  });
});
