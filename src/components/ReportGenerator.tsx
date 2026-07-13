"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { StoredReportRun, ReportPipelineKey, ReportPipelineProgress } from "@/lib/store";
import type { NationalEstimate } from "@/lib/estimator/client";
import { hasCandidateValidationCohort } from "@/lib/report/release";

const PIPELINES:ReportPipelineKey[]=["first-party-supply","regulatory","competitive-intensity","site-kol-discovery","standard-of-care","representativeness","eligibility-realism"];
const LABELS:Record<ReportPipelineKey,string>={
  "first-party-supply":"First-party supply",
  regulatory:"Regulatory",
  "competitive-intensity":"Competitive intensity",
  "site-kol-discovery":"Site / KOL discovery",
  "standard-of-care":"Standard of care",
  representativeness:"Representativeness",
  "eligibility-realism":"Eligibility realism",
};

export function pipelinesToTrigger(run:StoredReportRun):ReportPipelineKey[]{
  return run.pipelines
    .filter((pipeline)=>pipeline.status==="queued"||(pipeline.key==="first-party-supply"&&pipeline.status==="running"))
    .map((pipeline)=>pipeline.key);
}

export type DecisionLayerKind="quantitative"|"candidate-validation"|"pending";
export function decisionLayerKind(supply:ReportPipelineProgress|undefined):DecisionLayerKind{
  const estimate=supply?.result as NationalEstimate|undefined;
  const usable=supply?.status==="complete"||supply?.status==="partial";
  if(!usable)return "pending";
  if(hasCandidateValidationCohort(estimate))return "candidate-validation";
  return estimate?.eligibilityFractionApplied!==true?"pending":"quantitative";
}

function CompetitionEvidence({pipeline}:{pipeline:ReportPipelineProgress}){
  const result=pipeline.result as {schemaVersion?:string;cuts?:Array<{key:string;label:string;total:number|null;url:string}>;limitations?:string[]}|undefined;
  if(result?.schemaVersion!=="competition-landscape.v1"||!result.cuts?.length)return null;
  return <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
    {result.cuts.map((cut)=><div key={cut.key} style={{display:"flex",justifyContent:"space-between",gap:12,marginTop:6,fontSize:13}}>
      <a className="muted" href={cut.url} target="_blank" rel="noreferrer">{cut.label}</a><strong className="mono">{cut.total??"Unavailable"}</strong>
    </div>)}
    <p className="muted" style={{fontSize:12,marginBottom:0}}>Direct competition requires study-level validation of subtype, setting, treatment line, phase, eligibility and Brazilian-site overlap.</p>
  </div>;
}

type SiteKolCandidate={
  rank:number;
  name:string;
  institution:string;
  location:string|null;
  fitEvidence:string[];
  relevantTrialIds:string[];
  confidence:"high"|"medium"|"low";
  qualificationNeeded:string;
};
type SiteKolResult={
  schemaVersion?:string;
  exactTrialParticipation?:"confirmed"|"not_publicly_disclosed";
  candidates?:SiteKolCandidate[];
  gaps?:string[];
};

function SiteKolEvidence({pipeline}:{pipeline:ReportPipelineProgress}){
  const result=pipeline.result as SiteKolResult|undefined;
  if(result?.schemaVersion!=="site-kol-discovery.v3")return null;
  const candidates=result.candidates??[];
  return <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"}}>
    <p className="muted" style={{fontSize:12,marginTop:0}}><strong>Confirmed participation in this trial:</strong> {result.exactTrialParticipation==="confirmed"?"publicly confirmed":"none publicly disclosed"}.</p>
    {candidates.length>0?<>
      <div style={{display:"grid",gap:10}}>{candidates.slice(0,5).map((candidate)=><div key={`${candidate.rank}-${candidate.name}`} style={{padding:"10px 0",borderTop:"1px solid var(--border)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"baseline"}}>
          <strong>{candidate.rank}. {candidate.name}</strong>
          <span className={`cl-badge ${candidate.confidence==="high"?"cl-badge--success":candidate.confidence==="medium"?"cl-badge--info":"cl-badge--warning"}`}>{candidate.confidence} confidence</span>
        </div>
        <div className="muted" style={{fontSize:12}}>{candidate.institution}{candidate.location?` · ${candidate.location}`:""}</div>
        {candidate.fitEvidence.length>0&&<p style={{fontSize:13,margin:"6px 0"}}>{candidate.fitEvidence.join(" · ")}</p>}
        <div className="muted" style={{fontSize:12}}>Validate: {candidate.qualificationNeeded}</div>
        {candidate.relevantTrialIds.length>0&&<div style={{fontSize:12,marginTop:4}}>{candidate.relevantTrialIds.slice(0,3).map((nct,index)=><span key={nct}>{index>0?" · ":""}<a href={`https://clinicaltrials.gov/study/${encodeURIComponent(nct)}`} target="_blank" rel="noreferrer">{nct}</a></span>)}</div>}
      </div>)}</div>
      <p style={{fontSize:12,marginBottom:0}}><Link href="/investigators">Open the KOL / PI directory →</Link></p>
    </>:<p className="muted" style={{fontSize:13}}>No evidence-backed candidate was returned. Broaden the adjacent-trial search before site outreach.</p>}
  </div>;
}

export function ReportGenerator({consultationId,initialRun}:{consultationId:string;initialRun:StoredReportRun}){
  const started=useRef(false);
  const [run,setRun]=useState(initialRun);
  const reportHref=`/scorecard?view=engine&c=${encodeURIComponent(consultationId)}`;

  useEffect(()=>{
    if(started.current) return;
    started.current=true;
    const controller=new AbortController();
    const trigger=(pipeline:ReportPipelineKey)=>fetch(`/api/reports/${encodeURIComponent(consultationId)}/pipeline/${pipeline}`,{method:"POST",signal:controller.signal}).catch(()=>undefined);
    void Promise.allSettled(PIPELINES.map(trigger));
    const timer=window.setInterval(()=>{
      void fetch(`/api/reports/${encodeURIComponent(consultationId)}`,{cache:"no-store",signal:controller.signal})
        .then((response)=>response.ok?response.json():null)
        .then((body:{run?:StoredReportRun}|null)=>{
          if(!body?.run)return;
          setRun(body.run);
          const terminal=body.run.pipelines.every((pipeline)=>["complete","partial","failed"].includes(pipeline.status));
          if(terminal){window.clearInterval(timer);return;}
          // A request may fail before the route persists `running`. Retry every
          // still-queued pipeline; the server route is idempotent and leases
          // already-running work. first-party-supply also needs polling to
          // synchronize its durable Python job into the report.
          for(const pipeline of pipelinesToTrigger(body.run))void trigger(pipeline);
        })
        .catch(()=>undefined);
    },2000);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[consultationId]);

  const supply=run.pipelines.find((pipeline)=>pipeline.key==="first-party-supply");
  const supplyEstimate=supply?.result as NationalEstimate|undefined;
  const decisionKind=decisionLayerKind(supply);
  const done=run.pipelines.filter((pipeline)=>["complete","partial","failed"].includes(pipeline.status)).length;
  const usable=run.pipelines.filter((pipeline)=>["complete","partial"].includes(pipeline.status)).length;
  const failed=run.pipelines.filter((pipeline)=>pipeline.status==="failed").length;

  return <>
    <div className="card" aria-live="polite">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16}}>
        <div><h2 style={{marginBottom:4}}>Building feasibility report</h2><p className="sub" style={{marginTop:0}}>First-party supply and six protocol-driven evidence pipelines run independently. Completed evidence appears immediately.</p></div>
        <span className="mono muted">{done}/{run.pipelines.length} finished · {usable} usable{failed?` · ${failed} failed`:""}</span>
      </div>
      <div style={{height:6,background:"var(--border)",borderRadius:999,overflow:"hidden",margin:"16px 0"}}><div style={{height:"100%",width:`${100*done/run.pipelines.length}%`,background:"var(--brand)",transition:"width .25s ease"}}/></div>
      <div className="grid2">
        {run.pipelines.map((pipeline)=><article key={pipeline.key} style={{border:"1px solid var(--border)",borderRadius:8,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{LABELS[pipeline.key]}</strong><span className="mono muted" style={{fontSize:12}}>{pipeline.key==="site-kol-discovery"&&pipeline.status==="partial"&&((pipeline.result as SiteKolResult|undefined)?.candidates?.length??0)>0?"candidate validation":pipeline.status}</span></div>
          {pipeline.summary&&<p style={{marginBottom:6}}>{pipeline.summary}</p>}
          {pipeline.status==="running"&&<p className="muted" style={{fontSize:13}}>Searching and reconciling sources…</p>}
          {pipeline.status==="queued"&&<p className="muted" style={{fontSize:13}}>Queued</p>}
          {pipeline.error&&<p className="badge-low">{pipeline.error}</p>}
          {pipeline.key==="competitive-intensity"&&<CompetitionEvidence pipeline={pipeline}/>} 
          {pipeline.key==="site-kol-discovery"&&<SiteKolEvidence pipeline={pipeline}/>} 
          {!!pipeline.citations?.length&&<p className="muted" style={{fontSize:12}}>{pipeline.citations.length} {pipeline.key==="competitive-intensity"?`reproducible registry quer${pipeline.citations.length===1?"y":"ies"}`:`cited source${pipeline.citations.length===1?"":"s"}`}</p>}
        </article>)}
      </div>
    </div>
    <div className="card">
      <h2>Decision layer</h2>
      {decisionKind==="quantitative"?<><p className="sub">The quantitative spine is available. TrialBridge can now calculate the funnel, scores, forecast, ranking and uncertainty while remaining research dimensions continue to enrich the evidence layer.</p><Link className="cl-btn cl-btn--primary" href={reportHref}>Open feasibility decision report →</Link></>:decisionKind==="candidate-validation"?<>
        <h3 style={{marginBottom:6}}>Proceed to clinical candidate validation</h3>
        <p className="sub"><strong>Conditional operational recommendation:</strong> advance the {(supplyEstimate?.proprietaryFindingTotal??0).toLocaleString("en-US")} preselected candidates to source-site review, prioritized against the {(supplyEstimate?.baseCohort??0).toLocaleString("en-US")} observed DataSUS diagnosis records. This is a next-step recommendation, not a country go/no-go decision.</p>
        <p className="muted" style={{fontSize:13}}>Eligible-patient forecasts, composite scores and site ranking remain gated until clinical review supplies comparable pass/fail counts and a validated eligibility fraction.</p>
        <Link className="cl-btn cl-btn--primary" href={reportHref}>Open full evidence report →</Link>
      </>:<p className="sub">Decision support remains pending until a validated first-party supply result is available. Missing supply is never converted into zero.</p>}
    </div>
  </>;
}
