import type { Criterion, CriterionValue } from "@/lib/matcher/types";

export interface EstimatorCriterion { id:string; text:string; type:"inclusion"|"exclusion"; kind:"checkable"|"depth"; field:string; op:"in"|"eq"|"lte"|"gte"|"between"|"is_true"|"is_false"; value?:CriterionValue; assertion?:"PRESENT"|"ABSENT" }
export interface CompiledProtocol { protocol_id:string; criteria:EstimatorCriterion[]; coverage:{ total:number; applied:number; nlpPending:number; manualReview:number; omitted:{id:string;text:string;reason:string}[] } }

const DEPTH:Record<string,string>={her2:"her2",her2_status:"her2",ecog:"ecog",stage:"stage",metastatic:"metastatic",prior_lines:"prior_lines",autoimmune:"autoimmune"};
const positive=(v:CriterionValue)=>["positive","present","active","true","yes","iv"].includes(String(Array.isArray(v)?v[0]:v).toLowerCase());
function one(c:Criterion):EstimatorCriterion|string{
  if(c.baseFit==="nlp_extractable") return "requires an NLP extraction pass";
  if(c.baseFit==="not_answerable") return "not answerable from connected data";
  if(c.field==="diagnosis"||c.field==="dx"){
    const v=String(Array.isArray(c.value)?c.value[0]:c.value).toLowerCase();
    const dx=v.includes("idiopathic pulmonary fibrosis")||v==="ipf"
      ?"idiopathic_pulmonary_fibrosis"
      :v.includes("mature b-cell")||v.includes("mature b cell")
        ?"mature_b_cell_malignancy"
      :v.includes("breast")?"breast_cancer":v.includes("lung")||v.includes("nsclc")?"lung_cancer":null;
    return dx?{id:c.id,text:c.rawText,type:c.kind,kind:"checkable",field:"dx",op:"in",value:[dx]}:"diagnosis is not mapped to the proprietary/DataSUS vocabulary";
  }
  if(c.field==="age") return c.operator==="gte"&&c.value===18?{id:c.id,text:c.rawText,type:c.kind,kind:"checkable",field:"age_band",op:"in",value:["18-39","40-49","50-59","60-69","70+"]}:"exact age boundary is not representable in aggregate age bands";
  if(c.field==="sex") { const v=String(Array.isArray(c.value)?c.value[0]:c.value).toUpperCase(); const sex=v.startsWith("F")?"F":v.startsWith("M")?"M":null; return sex?{id:c.id,text:c.rawText,type:c.kind,kind:"checkable",field:"sex",op:"eq",value:sex}:"sex value is not mapped to F/M"; }
  const field=DEPTH[c.field]; if(!field) return "field is not available in the current depth extraction";
  if(c.kind==="exclusion") return positive(c.value)?{id:c.id,text:c.rawText,type:c.kind,kind:"depth",field,op:"is_false",assertion:"ABSENT"}:"exclusion shape cannot be represented safely";
  if(["her2","metastatic","autoimmune"].includes(field)) return {id:c.id,text:c.rawText,type:c.kind,kind:"depth",field,op:c.operator==="exists"||positive(c.value)?"is_true":"is_false"};
  const op=c.operator==="lt"?"lte":c.operator==="gt"?"gte":c.operator; if(!["eq","in","lte","gte","between"].includes(op)) return "operator is unsupported by the estimator";
  return {id:c.id,text:c.rawText,type:c.kind,kind:"depth",field,op:op as EstimatorCriterion["op"],value:field==="stage"&&positive(c.value)?4:c.value};
}
export function compileEstimatorProtocol(id:string,criteria:Criterion[]):CompiledProtocol{const out:EstimatorCriterion[]=[],omitted:CompiledProtocol["coverage"]["omitted"]=[];let nlpPending=0;for(const c of criteria){const r=one(c);if(typeof r==="string"){if(c.baseFit==="nlp_extractable")nlpPending++;omitted.push({id:c.id,text:c.rawText,reason:r});}else out.push(r);}return{protocol_id:id,criteria:out,coverage:{total:criteria.length,applied:out.length,nlpPending,manualReview:omitted.length-nlpPending,omitted}};}
