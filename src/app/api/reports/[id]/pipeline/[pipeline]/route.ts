import { NextResponse } from "next/server";
import { competitionCondition, competitionLandscapeSummary, fetchCompetitionLandscape } from "@/lib/ctgov/competition";
import { syncCmaEstimate } from "@/lib/estimator/cma-run";
import { loadInvestigatorDirectory } from "@/lib/kol/directory";
import { runTask } from "@/lib/parallel/client";
import { getConsultation, updateReportPipeline, type ReportPipelineKey } from "@/lib/store";

export const dynamic="force-dynamic";
export const maxDuration=900;

const PIPELINES:ReportPipelineKey[]=["first-party-supply","regulatory","competitive-intensity","site-kol-discovery","standard-of-care","representativeness","eligibility-realism"];
// A route may die after persisting `running` (deploy, timeout, process crash).
// maxDuration is 15 minutes, so a 20-minute lease safely distinguishes an
// abandoned run from one that can still be doing useful work.
const RUN_LEASE_MS=20*60*1000;
const schema={type:"object",additionalProperties:false,properties:{summary:{type:"string"},facts:{type:"array",items:{type:"object",additionalProperties:false,properties:{label:{type:"string"},value:{type:["string","number","null"]}},required:["label","value"]}},gaps:{type:"array",items:{type:"string"}}},required:["summary","facts","gaps"]};
const siteKolSchema={
  type:"object",
  additionalProperties:false,
  properties:{
    schemaVersion:{type:"string"},
    summary:{type:"string"},
    exactTrialParticipation:{type:"string"},
    candidates:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        properties:{
          rank:{type:"number"},
          name:{type:"string"},
          institution:{type:"string"},
          location:{type:["string","null"]},
          fitEvidence:{type:"array",items:{type:"string"}},
          relevantTrialIds:{type:"array",items:{type:"string"}},
          evidenceType:{type:"string"},
          confidence:{type:"string"},
          qualificationNeeded:{type:"string"},
        },
        required:["rank","name","institution","location","fitEvidence","relevantTrialIds","evidenceType","confidence","qualificationNeeded"],
      },
    },
    gaps:{type:"array",items:{type:"string"}},
  },
  required:["schemaVersion","summary","exactTrialParticipation","candidates","gaps"],
};

type SiteKolCandidate={rank:number;name:string;institution:string;location:string|null;fitEvidence:string[];relevantTrialIds:string[];evidenceType:string;confidence:string;qualificationNeeded:string};

function directoryCandidatesForProtocol(title:string):{candidates:SiteKolCandidate[];citations:Array<{url:string;title:string}>}{
  const diseasePattern=/breast/i.test(title)?/breast|mama|gbecam/i:null;
  if(!diseasePattern)return {candidates:[],citations:[]};
  const advancedBreast=/metastatic|hr\+|her2/i.test(title);
  const entries=loadInvestigatorDirectory().entries
    .filter((entry)=>{
      const diseaseEvidence=entry.evidenceStatus==="public_evidence"&&entry.citations.some((citation)=>diseasePattern.test(`${citation.label} ${citation.url??""}`));
      const breastNetwork=entry.societyRoles.includes("GBECAM")||entry.ctgovAffiliations.some((affiliation)=>/GBECAM|Grupo Brasileiro de Estudos do C[aâ]ncer de Mama/i.test(affiliation));
      return advancedBreast?breastNetwork:diseaseEvidence||breastNetwork;
    })
    .sort((a,b)=>{
      const score=(entry:typeof a)=>(entry.confidence?.toLowerCase()==="high"?75:0)+(entry.societyRoles.includes("GBECAM")?100:0)+(entry.guidelineAuthor?30:0)+entry.ctgovTrialCount*20+(entry.pubsCountTa??0);
      return score(b)-score(a);
    })
    .slice(0,5);
  const candidates=entries.map((entry,index):SiteKolCandidate=>({
    rank:index+1,
    name:entry.name.replace(/,?\s+(MD|PhD|M\.D\.|P\.h\.D\.)\b.*$/i,""),
    institution:entry.facilities[0]?.name??entry.ctgovAffiliations[0]??"Institution requires confirmation",
    location:entry.facilities[0]?[entry.facilities[0].city,entry.facilities[0].uf].filter(Boolean).join(" · ")||null:null,
    fitEvidence:[
      entry.ctgovTrialCount>0?`Registered ${entry.ctgovRoles.map((role)=>role.replaceAll("_"," ").toLowerCase()).join("/")} experience (${entry.ctgovNctIds.join(", ")})`:null,
      entry.pubsCountTa!=null?`${entry.pubsCountTa} disease-area publications identified`:null,
      entry.societyRoles.length?`${entry.societyRoles.join(" / ")} activity`:null,
      entry.guidelineAuthor?"Brazilian breast-cancer guideline authorship":null,
    ].filter((value):value is string=>Boolean(value)),
    relevantTrialIds:entry.ctgovNctIds,
    evidenceType:"multiple_signals",
    confidence:entry.confidence?.toLowerCase()??"medium",
    qualificationNeeded:"Verify HR+/HER2− metastatic volume after CDK4/6 therapy, routine PIK3CA testing, competing trials, site capacity and investigator interest.",
  }));
  const citations=entries.flatMap((entry)=>entry.citations.filter((citation)=>citation.url).map((citation)=>({url:citation.url!,title:citation.label})));
  return {candidates,citations};
}

function isNamedPerson(value:string):boolean{
  const name=value.trim();
  return name.split(/\s+/).length>=2&&!/\b(members|investigators|sites?|hospitals?|society|group|team)\b/i.test(name);
}

function objective(key:Exclude<ReportPipelineKey,"first-party-supply"|"competitive-intensity">,title:string,criteria:string){
  const common=`Protocol: ${title}. Geography: Brazil. Eligibility context: ${criteria}. Return only cited facts current as of today; use null for unavailable quantitative values.`;
  const prompts:Record<typeof key,string>={
    regulatory:`Research the applicable ANVISA, CONEP/CEP, import-license and regulatory timelines. ${common}`,
    "site-kol-discovery":`Map and rank potential Brazilian investigators for this protocol, even when no Brazilian investigator or site is publicly disclosed for the exact trial. First state exact-trial participation separately as confirmed or not_publicly_disclosed. Then identify named, Brazil-based feasibility candidates using directly relevant registered-trial experience in the same disease, biomarker, setting or treatment line; disease-area publications; and oncology society or guideline leadership. A prestigious institution alone is not enough evidence. For every candidate return institution, location, concise fit evidence, relevant NCT IDs when available, evidence type, confidence and the most important qualification gap. Do not call a candidate a confirmed investigator for this protocol unless a registry or sponsor source explicitly says so. Rank strongest multi-signal candidates first and return an empty candidates array only after searching adjacent registered trials and disease-area evidence. ${common}`,
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
  const runningIsFresh=existing?.status==="running"&&Boolean(existing.startedAt)&&Date.now()-Date.parse(existing.startedAt!)<RUN_LEASE_MS;
  const existingResult=existing?.result as {schemaVersion?:string}|undefined;
  const refreshLegacyCompetition=pipeline==="competitive-intensity"&&Boolean(existing&&["complete","partial"].includes(existing.status))&&existingResult?.schemaVersion!=="competition-landscape.v1";
  const refreshLegacySiteKol=pipeline==="site-kol-discovery"&&Boolean(existing&&["complete","partial"].includes(existing.status))&&existingResult?.schemaVersion!=="site-kol-discovery.v3";
  if(existing&&pipeline!=="first-party-supply"&&!refreshLegacyCompetition&&!refreshLegacySiteKol&&(["complete","partial"].includes(existing.status)||runningIsFresh)) return NextResponse.json({pipeline:existing},{status:runningIsFresh?202:200});
  const startedAt=new Date().toISOString();
  await updateReportPipeline(id,pipeline,{status:"running",startedAt,completedAt:undefined,summary:undefined,result:undefined,citations:undefined,error:undefined});
  try{
    if(pipeline==="first-party-supply"){
      // Retry a previously failed durable job once when the report pipeline is
      // first triggered. While the report is polling a running supply pipeline,
      // a failed CMA result must be surfaced instead of being requeued forever.
      const sync=await syncCmaEstimate(consultation,{retryFailed:existing?.status!=="running"});
      if(sync.status==="running"||sync.status==="queued"){
        const run=await updateReportPipeline(id,pipeline,{status:"running",summary:`CMA stage: ${sync.stage}`});
        return NextResponse.json({run},{status:202});
      }
      if(sync.status==="failed") throw new Error(sync.error||"CMA feasibility run failed");
      const refreshed=await getConsultation(id);
      const estimate=refreshed?.estimateResult;
      if(!estimate) throw new Error("CMA completed without a validated cohort result");
      const estimateStatus=sync.status==="complete"?"complete":"partial";
      const completedAt=new Date().toISOString();
      const proprietaryCandidates=estimate.proprietaryFindingTotal??0;
      const summary=estimateStatus==="partial"&&proprietaryCandidates>0
        ?`${estimate.baseCohort.toLocaleString("en-US")} DataSUS base-cohort records · ${proprietaryCandidates.toLocaleString("en-US")} proprietary candidates requiring review.`
        :`${Math.round(estimate.estimatedN).toLocaleString("en-US")} estimated eligible from a ${estimate.baseCohort.toLocaleString("en-US")} DataSUS base cohort.`;
      const run=await updateReportPipeline(id,pipeline,{status:estimateStatus,completedAt,summary,result:estimate});
      return NextResponse.json({run});
    }
    if(pipeline==="competitive-intensity"){
      const result=await fetchCompetitionLandscape(
        competitionCondition(consultation.title, consultation.criteria),
        consultation.title,
      );
      if(result.source!=="live") throw new Error(result.note||"ClinicalTrials.gov unavailable");
      if(!("schemaVersion" in result)) throw new Error("ClinicalTrials.gov competition landscape was incomplete");
      const completedAt=new Date().toISOString();
      const citations=result.cuts.map((cut)=>({title:cut.label,url:cut.url}));
      const run=await updateReportPipeline(id,pipeline,{status:"partial",completedAt,summary:competitionLandscapeSummary(result),result,citations,error:undefined});
      return NextResponse.json({run});
    }
    const criteria=consultation.criteria.slice(0,12).map((criterion)=>criterion.rawText).join(" | ");
    const result=await runTask(objective(pipeline,consultation.title,criteria),{outputSchema:pipeline==="site-kol-discovery"?siteKolSchema:schema,processor:"base-fast",pollMs:3000,maxPolls:120});
    if(result.status!=="completed"||!result.content) throw new Error(result.error||"Parallel research unavailable");
    let content=result.content as Record<string,unknown>;
    const researchCitations=result.basis.flatMap((basis)=>basis.citations).filter((citation)=>citation.url).map((citation)=>({url:citation.url!,title:citation.title||citation.url!}));
    const local=pipeline==="site-kol-discovery"?directoryCandidatesForProtocol(consultation.title):{candidates:[],citations:[]};
    if(pipeline==="site-kol-discovery"){
      const researched=Array.isArray(content.candidates)?(content.candidates as SiteKolCandidate[]).filter((candidate)=>candidate&&typeof candidate.name==="string"&&isNamedPerson(candidate.name)&&Array.isArray(candidate.relevantTrialIds)&&candidate.relevantTrialIds.length>0):[];
      const seen=new Set(local.candidates.map((candidate)=>candidate.name.toLocaleLowerCase("pt-BR")));
      const candidates=[...local.candidates,...researched.filter((candidate)=>!seen.has(candidate.name.toLocaleLowerCase("pt-BR")))].slice(0,8).map((candidate,index)=>({...candidate,rank:index+1}));
      const exactTrialParticipation=String(content.exactTrialParticipation??"").toLowerCase().includes("confirm")?"confirmed":"not_publicly_disclosed";
      content={...content,schemaVersion:"site-kol-discovery.v3",exactTrialParticipation,candidates};
      content.summary=`${exactTrialParticipation==="confirmed"?"Brazilian sites are publicly listed for the exact trial; named site investigators are not publicly disclosed.":"No Brazilian participation is publicly disclosed for the exact trial."} ${candidates.length} evidence-backed investigator candidates are mapped for qualification; none is presented as a confirmed investigator for this protocol.`;
    }
    const citations=[...new Map([...researchCitations,...local.citations].map((citation)=>[citation.url,citation])).values()];
    const summary=typeof content.summary==="string"?content.summary:`${pipeline} research completed.`;
    const completedAt=new Date().toISOString();
    const status=pipeline==="site-kol-discovery"?"partial":citations.length?"complete":"partial";
    const run=await updateReportPipeline(id,pipeline,{status,completedAt,summary,result:content,citations,error:citations.length?undefined:"Research returned no direct citations."});
    return NextResponse.json({run});
  }catch(error){
    const message=error instanceof Error?error.message:"Pipeline failed";
    const run=await updateReportPipeline(id,pipeline,{status:"failed",completedAt:new Date().toISOString(),error:message});
    return NextResponse.json({run,error:message},{status:503});
  }
}
