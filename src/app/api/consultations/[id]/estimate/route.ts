import {NextResponse} from "next/server";
import {getConsultation} from "@/lib/store";
import {syncCmaEstimate} from "@/lib/estimator/cma-run";

export const dynamic="force-dynamic";

async function synchronize(id:string,retryFailed=false){
  const consultation=await getConsultation(id);
  if(!consultation)return NextResponse.json({error:"not found"},{status:404});
  try{
    const sync=await syncCmaEstimate(consultation,{retryFailed});
    const refreshed=await getConsultation(id);
    return NextResponse.json({status:sync.status,stage:sync.stage,protocol:refreshed?.estimateProtocol,estimate:refreshed?.estimateResult,error:sync.error??refreshed?.estimateError,estimatedAt:refreshed?.estimatedAt},{status:sync.status==="running"||sync.status==="queued"?202:200});
  }catch(error){
    const message=error instanceof Error?error.message:"CMA synchronization failed";
    return NextResponse.json({status:"failed",stage:"failed",error:message},{status:503});
  }
}

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return synchronize(id,false);
}

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return synchronize(id,true);
}
