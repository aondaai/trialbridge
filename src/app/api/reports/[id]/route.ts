import { NextResponse } from "next/server";
import { getConsultation } from "@/lib/store";

export const dynamic="force-dynamic";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const consultation=await getConsultation(id);
  if(!consultation) return NextResponse.json({error:"not found"},{status:404});
  return NextResponse.json({run:consultation.reportRun,estimateStatus:consultation.estimateStatus});
}
