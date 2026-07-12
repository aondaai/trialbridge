import { NextResponse } from "next/server";
import { fetchCompetition } from "@/lib/ctgov/competition";
import { fetchNationalEstimate } from "@/lib/estimator/client";
import { compileEstimatorProtocol } from "@/lib/estimator/protocol";
import { runTask } from "@/lib/parallel/client";
import { getConsultation, updateConsultationEstimate, updateReportPipeline, type ReportPipelineKey } from "@/lib/store";

export const dynamic="force-dynamic";
export const maxDuration=900;

const PIPELINES:ReportPipelineKey[]=["first-party-supply","regulatory","competitive-intensity","site-kol-discovery","standard-of-care","representativeness","eligibility-realism"];
const schema={type:"object",additionalProperties:false,properties:{summary:{type:"string"},facts:{type:"array",items:{type:"object",additionalProperties:false,properties:{label:{type:"string"},value:{type:["string","number","null"]}},required:["label","value"]}},gaps:{type:"array",items:{type:"string"}}},required:["summary","facts","gaps"]};

function condition(title:string){
  const value=title.toLowerCase();
  if(/breast/.test(value)) return "breast cancer";
  if(/nsclc|lung/.test(value)) return "non-small cell lung cancer";
  if(/melanoma/.test(value)) return "melanoma";
  if(/colorectal|\bcrc\b/.test(value)) return "colorectal cancer";
  return title.replace(/^phase\s+[ivx]+\s*[—-]\s*/i,"").replace(/\([^)]*\)/g,"").trim()||title;
}

function objective(key:Exclude<ReportPipelineKey,"first-party-supply"|"competitive-intensity">,title:string,criteria:string){
  const common=`Protocol: ${title}. Geography: Brazil. Eligibility context: ${criteria}. Return only cited facts current as of today; use null for unavailable quantitative values.`;
  const prompts:Record<typeof key,string>={
    regulatory:`Research the applicable ANVISA, CONEP/CEP, import-license and regulatory timelines. ${common}`,
    "site-kol-discovery":`Find Brazilian sites and investigators with directly relevant registered-trial experience and cited capacity signals. ${common}`,
    "standard-of-care":`Research current Brazilian standard of care, access differences between SUS and private care, comparator and prior-line availability. ${common}`,
    representativeness:`Find authoritative Brazilian demographic and regional reference distributions relevant to this indication. Label proxy populations. ${common}`,
    "eligibility-realism":`Find external prevalence ranges for the highest-impact eligibility features as sanity checks, never as patient counts. ${common}`,
  };
  return prompts[key];
}

export async function POST(_:Request,{params}:{params:Promise<{id:string;pipeline:string}>}){
  const {id,pipeline:raw}=await params;
  if(!PIPELINES.includes(raw as ReportPipelineKey)) return NextResponse.json({error:"unknown pipeline"},{status:400});
  const pipeline=raw as ReportPipelineKey;
  const consultation=await getConsultation(id);
  if(!consultation) return NextResponse.json({error:"not found"},{status:404});
  const existing=consultation.reportRun?.pipelines.find((item)=>item.key===pipeline);
  if(existing&&["running","complete","partial"].includes(existing.status)) return NextResponse.json({pipeline:existing},{status:existing.status==="running"?202:200});
  const startedAt=new Date().toISOString();
  await updateReportPipeline(id,pipeline,{status:"running",startedAt,error:undefined});
  try{
    if(pipeline==="first-party-supply"){
      const protocol=consultation.estimateProtocol??compileEstimatorProtocol(id,consultation.criteria);
      const estimate=await fetchNationalEstimate(protocol);
      if(!estimate) throw new Error("Estimator unavailable or no validated cohort was returned");
      const estimateStatus=protocol.coverage.applied===protocol.coverage.total?"complete":"partial";
      const completedAt=new Date().toISOString();
      await updateConsultationEstimate(id,{estimateStatus,estimateProtocol:protocol,estimateResult:estimate,estimatedAt:completedAt});
      const run=await updateReportPipeline(id,pipeline,{status:estimateStatus,completedAt,summary:`${Math.round(estimate.estimatedN).toLocaleString("en-US")} estimated eligible from a ${estimate.baseCohort.toLocaleString("en-US")} DataSUS base cohort.`,result:estimate});
      return NextResponse.json({run});
    }
    if(pipeline==="competitive-intensity"){
      const result=await fetchCompetition(condition(consultation.title));
      if(result.source!=="live") throw new Error(result.note||"ClinicalTrials.gov unavailable");
      const completedAt=new Date().toISOString();
      const run=await updateReportPipeline(id,pipeline,{status:"complete",completedAt,summary:`${result.total} recruiting Brazilian studies found in ClinicalTrials.gov.`,result,citations:[{title:"ClinicalTrials.gov",url:"https://clinicaltrials.gov/"}]});
      return NextResponse.json({run});
    }
    const criteria=consultation.criteria.slice(0,12).map((criterion)=>criterion.rawText).join(" | ");
    const result=await runTask(objective(pipeline,consultation.title,criteria),{outputSchema:schema,processor:"base-fast",pollMs:3000,maxPolls:120});
    if(result.status!=="completed"||!result.content) throw new Error(result.error||"Parallel research unavailable");
    const citations=[...new Map(result.basis.flatMap((basis)=>basis.citations).filter((citation)=>citation.url).map((citation)=>[citation.url!,{url:citation.url!,title:citation.title||citation.url!}])).values()];
    const summary=typeof result.content.summary==="string"?result.content.summary:`${pipeline} research completed.`;
    const completedAt=new Date().toISOString();
    const run=await updateReportPipeline(id,pipeline,{status:citations.length?"complete":"partial",completedAt,summary,result:result.content,citations,error:citations.length?undefined:"Research returned no direct citations."});
    return NextResponse.json({run});
  }catch(error){
    const message=error instanceof Error?error.message:"Pipeline failed";
    const run=await updateReportPipeline(id,pipeline,{status:"failed",completedAt:new Date().toISOString(),error:message});
    return NextResponse.json({run,error:message},{status:503});
  }
}
