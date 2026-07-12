"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { StoredReportRun, ReportPipelineKey } from "@/lib/store";

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

export function ReportGenerator({consultationId,initialRun}:{consultationId:string;initialRun:StoredReportRun}){
  const started=useRef(false);
  const [run,setRun]=useState(initialRun);
  const reportHref=`/scorecard?view=engine&c=${encodeURIComponent(consultationId)}`;

  useEffect(()=>{
    if(started.current) return;
    started.current=true;
    const controller=new AbortController();
    void Promise.allSettled(PIPELINES.map((pipeline)=>fetch(`/api/reports/${encodeURIComponent(consultationId)}/pipeline/${pipeline}`,{method:"POST",signal:controller.signal})));
    const timer=window.setInterval(()=>{
      void fetch(`/api/reports/${encodeURIComponent(consultationId)}`,{cache:"no-store",signal:controller.signal})
        .then((response)=>response.ok?response.json():null)
        .then((body:{run?:StoredReportRun}|null)=>{if(body?.run)setRun(body.run);})
        .catch(()=>undefined);
    },2000);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[consultationId]);

  const supply=run.pipelines.find((pipeline)=>pipeline.key==="first-party-supply");
  const decisionReady=supply?.status==="complete"||supply?.status==="partial";
  const done=run.pipelines.filter((pipeline)=>["complete","partial","failed"].includes(pipeline.status)).length;

  return <>
    <div className="card" aria-live="polite">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16}}>
        <div><h2 style={{marginBottom:4}}>Building feasibility report</h2><p className="sub" style={{marginTop:0}}>First-party supply and six protocol-driven evidence pipelines run independently. Completed evidence appears immediately.</p></div>
        <span className="mono muted">{done}/{run.pipelines.length}</span>
      </div>
      <div style={{height:6,background:"var(--border)",borderRadius:999,overflow:"hidden",margin:"16px 0"}}><div style={{height:"100%",width:`${100*done/run.pipelines.length}%`,background:"var(--brand)",transition:"width .25s ease"}}/></div>
      <div className="grid2">
        {run.pipelines.map((pipeline)=><article key={pipeline.key} style={{border:"1px solid var(--border)",borderRadius:8,padding:14}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8}}><strong>{LABELS[pipeline.key]}</strong><span className="mono muted" style={{fontSize:12}}>{pipeline.status}</span></div>
          {pipeline.summary&&<p style={{marginBottom:6}}>{pipeline.summary}</p>}
          {pipeline.status==="running"&&<p className="muted" style={{fontSize:13}}>Searching and reconciling sources…</p>}
          {pipeline.status==="queued"&&<p className="muted" style={{fontSize:13}}>Queued</p>}
          {pipeline.error&&<p className="badge-low">{pipeline.error}</p>}
          {!!pipeline.citations?.length&&<p className="muted" style={{fontSize:12}}>{pipeline.citations.length} cited source{pipeline.citations.length===1?"":"s"}</p>}
        </article>)}
      </div>
    </div>
    <div className="card">
      <h2>Decision layer</h2>
      {decisionReady?<><p className="sub">The quantitative spine is available. TrialBridge can now calculate the funnel, scores, forecast, ranking and uncertainty while remaining research dimensions continue to enrich the evidence layer.</p><Link className="cl-btn cl-btn--primary" href={reportHref}>Open feasibility decision report →</Link></>:<p className="sub">Scores and recommendation remain withheld until a validated first-party supply result is available. Missing supply is never converted into zero.</p>}
    </div>
  </>;
}
