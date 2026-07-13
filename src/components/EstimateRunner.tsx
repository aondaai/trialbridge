"use client";

import{useEffect,useRef}from"react";
import{useRouter}from"next/navigation";

const TERMINAL=new Set(["complete","partial"]);

export function EstimateRunner({consultationId,status}:{consultationId:string;status?:string}){
  const router=useRouter();
  const active=useRef(false);
  useEffect(()=>{
    if(active.current||TERMINAL.has(status??"pending"))return;
    active.current=true;
    let cancelled=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const url=`/api/consultations/${encodeURIComponent(consultationId)}/estimate`;
    const poll=async(method:"POST"|"GET")=>{
      try{
        const response=await fetch(url,{method,cache:"no-store"});
        const body=await response.json().catch(()=>({})) as {status?:string};
        if(cancelled)return;
        if(body.status&&TERMINAL.has(body.status)){router.refresh();return;}
        if(body.status==="failed"){router.refresh();return;}
        timer=setTimeout(()=>void poll("GET"),3000);
      }catch{
        if(!cancelled)timer=setTimeout(()=>void poll("GET"),5000);
      }
    };
    void poll("POST");
    return()=>{cancelled=true;if(timer)clearTimeout(timer);active.current=false;};
  },[consultationId,status,router]);
  return null;
}
