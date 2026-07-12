"use client";
import{useEffect,useRef}from"react";import{useRouter}from"next/navigation";
export function EstimateRunner({consultationId,status}:{consultationId:string;status?:string}){const router=useRouter(),started=useRef(false);useEffect(()=>{if(started.current||!["pending","running","failed"].includes(status??"pending"))return;started.current=true;fetch(`/api/consultations/${encodeURIComponent(consultationId)}/estimate`,{method:"POST"}).finally(()=>router.refresh());},[consultationId,status,router]);return null;}
