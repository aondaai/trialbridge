import{describe,it,expect}from"vitest";import{compileEstimatorProtocol}from"@/lib/estimator/protocol";
describe("estimator protocol compilation",()=>{
  it("treats an inclusion existence criterion for HER2 as present",()=>{const p=compileEstimatorProtocol("p",[{id:"h",kind:"inclusion",field:"her2",operator:"exists",value:null,rawText:"HER2 alteration",confidence:1,baseFit:"depth"}]);expect(p.criteria[0]).toMatchObject({field:"her2",op:"is_true"});});
  it("does not invent a diagnosis cohort",()=>{const p=compileEstimatorProtocol("p",[{id:"a",kind:"inclusion",field:"age",operator:"gte",value:18,rawText:"Adults",confidence:1,baseFit:"checkable"}]);expect(p.criteria.some(c=>c.field==="dx")).toBe(false);});
});
