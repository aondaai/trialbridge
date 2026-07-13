import{createHash}from"node:crypto";
import{beforeEach,describe,expect,it,vi}from"vitest";

const mocks=vi.hoisted(()=>({
  fetchCmaRun:vi.fn(),
  startCmaRun:vi.fn(),
  updateConsultationEstimate:vi.fn(),
}));

vi.mock("@/lib/estimator/cma",()=>({fetchCmaRun:mocks.fetchCmaRun,startCmaRun:mocks.startCmaRun}));
vi.mock("@/lib/store",()=>({updateConsultationEstimate:mocks.updateConsultationEstimate}));

import{syncCmaEstimate}from"@/lib/estimator/cma-run";
import type{StoredConsultation}from"@/lib/store";

const criteria=[{id:"dx",kind:"inclusion" as const,field:"diagnosis",operator:"eq" as const,value:"breast cancer",rawText:"Breast cancer",confidence:1,baseFit:"checkable" as const}];
const elasticsearchPlan={schemaVersion:"elasticsearch-funnel.v1" as const,source:"deterministic" as const,reviewedAt:"2026-07-13T00:00:00Z",note:"reviewed",stages:[{criterionId:"dx",criterionText:"Breast cancer",stageType:"INCLUSION" as const,automation:"ASSISTED" as const,rationale:"text",limitations:[],query:{bool:{must:[{match_phrase:{"preds.text":{query:"breast cancer"}}}],filter:[],should:[]}}}]};
const consultation:StoredConsultation={id:"c1",sponsorName:"Sponsor",title:"Study",nct:"NCT06253871",protocolText:"Breast cancer",criteria,elasticsearchPlan,createdAt:"2026-07-12T00:00:00Z"};
const criteriaHash=`sha256:${createHash("sha256").update(JSON.stringify({executionVersion:"local-reviewed-v7-mature-b-cell-datasus",nct:consultation.nct,protocolText:consultation.protocolText,criteria,elasticsearchPlan})).digest("hex")}`;

describe("CMA estimate synchronization",()=>{
  beforeEach(()=>vi.clearAllMocks());

  it("does not reuse a completed estimate after criteria changed",async()=>{
    const stale={...consultation,estimateStatus:"complete" as const,estimateRunId:"old",estimateCriteriaHash:"sha256:"+"0".repeat(64),estimateResult:{protocolId:"c1"} as never};
    mocks.fetchCmaRun.mockResolvedValue({id:"old",criteriaHash:"sha256:"+"0".repeat(64),status:"complete",stage:"complete",result:null,error:null,updatedAt:"now"});
    mocks.startCmaRun.mockResolvedValue({id:"new",criteriaHash,status:"queued",stage:"queued",result:null,error:null,updatedAt:"now"});
    const result=await syncCmaEstimate(stale);
    expect(mocks.startCmaRun).toHaveBeenCalledOnce();
    expect(result.status).toBe("running");
  });

  it("retries a failed matching job only when explicitly requested",async()=>{
    const failed={...consultation,estimateStatus:"failed" as const,estimateRunId:"run"};
    mocks.fetchCmaRun.mockResolvedValue({id:"run",criteriaHash,status:"failed",stage:"failed",result:null,error:"temporary",updatedAt:"now"});
    mocks.startCmaRun.mockResolvedValue({id:"run",criteriaHash,status:"queued",stage:"queued",result:null,error:null,updatedAt:"now"});
    await syncCmaEstimate(failed,{retryFailed:true});
    expect(mocks.startCmaRun).toHaveBeenCalledWith(expect.any(Object),{retryFailed:true});
  });

  it("preserves a partial terminal status returned by the estimator",async()=>{
    const running={...consultation,estimateStatus:"running" as const,estimateRunId:"run",estimateCriteriaHash:criteriaHash};
    mocks.fetchCmaRun.mockResolvedValue({id:"run",criteriaHash,status:"partial",stage:"partial",result:{protocolId:"c1"},error:null,updatedAt:"now"});
    const result=await syncCmaEstimate(running);
    expect(result).toMatchObject({status:"partial",stage:"partial"});
    expect(mocks.updateConsultationEstimate).toHaveBeenCalledWith("c1",expect.objectContaining({estimateStatus:"partial"}));
  });

  it("passes the reviewed mature B-cell CID family to the estimator",async()=>{
    const bCell={...consultation,nct:"NCT05544019",criteria:[{...criteria[0],value:"mature b-cell malignancy",rawText:"Mature B-cell malignancy"}]};
    mocks.startCmaRun.mockResolvedValue({id:"b-cell",criteriaHash:expect.any(String),status:"queued",stage:"queued",result:null,error:null,updatedAt:"now"});
    await syncCmaEstimate(bCell);
    expect(mocks.startCmaRun).toHaveBeenCalledWith(expect.objectContaining({dx:{concepts:["mature_b_cell_malignancy"],cid_prefixes:["C82","C83","C85","C88","C911"]}}));
  });
});
