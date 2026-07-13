import type { Criterion } from "@/lib/matcher/types";
import type { ElasticsearchQueryPlan } from "@/lib/elasticsearch/types";
import { nationalEstimateFromRaw, type NationalEstimate, type RawEstimate } from "./client";

const BASE_URL = process.env.TB_ESTIMATOR_URL ?? "http://127.0.0.1:8421";
const ESTIMATOR_TOKEN = process.env.TB_ESTIMATOR_TOKEN?.trim();
const REQUEST_TIMEOUT_MS=10_000;

export type CmaRunStatus = "queued"|"intake_running"|"proprietary_running"|"datasus_running"|"complete"|"partial"|"failed";

interface RawCmaRun {
  id:string;
  consultation_id:string;
  criteria_hash:string;
  status:CmaRunStatus;
  current_stage:string;
  result:RawEstimate|null;
  error:string|null;
  created_at:string;
  updated_at:string;
}

export interface CmaRun {
  id:string;
  criteriaHash:string;
  status:CmaRunStatus;
  stage:string;
  result:NationalEstimate|null;
  error:string|null;
  updatedAt:string;
}

function headers():Record<string,string>{
  const value:Record<string,string>={"content-type":"application/json"};
  if(ESTIMATOR_TOKEN)value.authorization=`Bearer ${ESTIMATOR_TOKEN}`;
  return value;
}

function normalize(run:RawCmaRun):CmaRun{
  return {id:run.id,criteriaHash:run.criteria_hash,status:run.status,stage:run.current_stage,result:run.result?nationalEstimateFromRaw(run.result):null,error:run.error,updatedAt:run.updated_at};
}

async function requireOk(response:Response,operation:string):Promise<void>{
  if(response.ok)return;
  const body=await response.json().catch(()=>null) as {detail?:string}|null;
  throw new Error(`${operation} failed (HTTP ${response.status})${body?.detail?`: ${body.detail}`:""}`);
}

export async function startCmaRun(input:{consultationId:string;nct:string;protocolText:string;criteria:Criterion[];criteriaHash:string;elasticsearchPlan?:ElasticsearchQueryPlan;dx?:{concepts:string[];cid_prefixes:string[]}},options:{retryFailed?:boolean}={}):Promise<CmaRun>{
  const suffix=options.retryFailed?"?retry_failed=true":"";
  const response=await fetch(`${BASE_URL}/cma/runs${suffix}`,{method:"POST",headers:headers(),body:JSON.stringify({
    consultation_id:input.consultationId,nct:/^NCT\d{8}$/i.test(input.nct)?input.nct.toUpperCase():"UNREGISTERED",
    protocol_text:input.protocolText,verified_criteria:input.criteria,criteria_hash:input.criteriaHash,
    elasticsearch_plan:input.elasticsearchPlan,dx:input.dx??{},
  }),cache:"no-store",signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  await requireOk(response,"CMA job creation");
  return normalize(await response.json() as RawCmaRun);
}

export async function fetchCmaRun(runId:string):Promise<CmaRun>{
  const response=await fetch(`${BASE_URL}/cma/runs/${encodeURIComponent(runId)}`,{headers:headers(),cache:"no-store",signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  await requireOk(response,"CMA job lookup");
  return normalize(await response.json() as RawCmaRun);
}
