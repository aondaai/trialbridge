import {createHash} from "node:crypto";
import {compileEstimatorProtocol} from "./protocol";
import {fetchCmaRun,startCmaRun,type CmaRunStatus} from "./cma";
import {updateConsultationEstimate,type StoredConsultation,type EstimateStatus} from "@/lib/store";

export interface EstimateSyncResult{status:EstimateStatus|"queued";stage:CmaRunStatus;error?:string}
// Bump whenever source-selection semantics change so a terminal result from an
// older executor cannot be mistaken for a valid consultation-specific result.
const CMA_EXECUTION_VERSION="local-reviewed-v7-mature-b-cell-datasus";

export async function syncCmaEstimate(c:StoredConsultation,options:{retryFailed?:boolean}={}):Promise<EstimateSyncResult>{
  const protocol=compileEstimatorProtocol(c.id,c.criteria);
  const hash=createHash("sha256").update(JSON.stringify({executionVersion:CMA_EXECUTION_VERSION,nct:c.nct??null,protocolText:c.protocolText,criteria:c.criteria,elasticsearchPlan:c.elasticsearchPlan})).digest("hex");
  const criteriaHash=`sha256:${hash}`;
  if(!protocol.criteria.some(item=>item.kind==="checkable"&&item.field==="dx")){
    const error="A validated diagnosis/CID cohort is required before proprietary finding and DataSUS expansion can run.";
    await updateConsultationEstimate(c.id,{estimateStatus:"failed",estimateCriteriaHash:criteriaHash,estimateProtocol:protocol,estimateError:error,clearResult:true});
    return {status:"failed",stage:"failed",error};
  }
  if(!c.elasticsearchPlan?.reviewedAt){
    const error="A sponsor-reviewed Elasticsearch plan is required for local CMA execution.";
    await updateConsultationEstimate(c.id,{estimateStatus:"failed",estimateCriteriaHash:criteriaHash,estimateProtocol:protocol,estimateError:error,clearResult:true});
    return {status:"failed",stage:"failed",error};
  }
  const dxCriterion=protocol.criteria.find(item=>item.kind==="checkable"&&item.field==="dx");
  const dxConcept=String(Array.isArray(dxCriterion?.value)?dxCriterion?.value[0]:dxCriterion?.value??"");
  const cidPrefixes=dxConcept==="breast_cancer"?["C50"]
    :dxConcept==="lung_cancer"?["C34"]
    :dxConcept==="idiopathic_pulmonary_fibrosis"?["J841"]
    :dxConcept==="mature_b_cell_malignancy"?["C82","C83","C85","C88","C911"]:[];
  const cmaInput={consultationId:c.id,nct:c.nct??"UNREGISTERED",protocolText:c.protocolText,criteria:c.criteria,criteriaHash,elasticsearchPlan:c.elasticsearchPlan,dx:{concepts:[dxConcept],cid_prefixes:cidPrefixes}};
  if(["complete","partial"].includes(c.estimateStatus??"")&&c.estimateResult?.protocolId===c.id&&c.estimateCriteriaHash===criteriaHash){
    return {status:c.estimateStatus as EstimateStatus,stage:c.estimateStatus as "complete"|"partial"};
  }
  let prior:Awaited<ReturnType<typeof fetchCmaRun>>|null=null;
  if(c.estimateRunId){
    try{prior=await fetchCmaRun(c.estimateRunId);}catch{prior=null;}
  }
  const matching=prior?.criteriaHash===criteriaHash?prior:null;
  const run=matching?.status==="failed"&&options.retryFailed
    ?await startCmaRun(cmaInput,{retryFailed:true})
    :matching??await startCmaRun(cmaInput);
  if(run.status==="failed"){
    const error=run.error??"CMA feasibility run failed";
    await updateConsultationEstimate(c.id,{estimateStatus:"failed",estimateRunId:run.id,estimateCriteriaHash:criteriaHash,estimateProtocol:protocol,estimateError:error,clearResult:true});
    return {status:"failed",stage:"failed",error};
  }
  if(["complete","partial"].includes(run.status)&&run.result){
    const finalStatus:EstimateStatus=run.status==="partial"||protocol.coverage.applied!==protocol.coverage.total?"partial":"complete";
    await updateConsultationEstimate(c.id,{estimateStatus:finalStatus,estimateRunId:run.id,estimateCriteriaHash:criteriaHash,estimateProtocol:protocol,estimateResult:run.result,estimatedAt:new Date().toISOString()});
    return {status:finalStatus,stage:run.status as "complete"|"partial"};
  }
  await updateConsultationEstimate(c.id,{estimateStatus:"running",estimateRunId:run.id,estimateCriteriaHash:criteriaHash,estimateProtocol:protocol,clearResult:c.estimateResult?.protocolId!==c.id||c.estimateCriteriaHash!==criteriaHash});
  return {status:"running",stage:run.status};
}
