import{describe,expect,it}from"vitest";
import{nationalEstimateFromRaw}from"@/lib/estimator/client";

describe("CMA feasibility result adapter",()=>{
  it("normalizes the Python aggregate contract without inventing unavailable fields",()=>{
    const result=nationalEstimateFromRaw({
      protocol_id:"consultation-1",
      national_estimated_n:25,
      national_ci_lo:20,
      national_ci_hi:30,
      national_base_cohort:100,
      by_region:[{region:"SP",est_eligible:25,ci_lo:20,ci_hi:30,base_cohort:100}],
      observed_by_site:[],
      bottlenecks:[],
      fill_speed_by_region:[],
      national_months_to_fill:null,
      proprietary_finding_total:7,
      datasus_source:"fixture",
    });
    expect(result.protocolId).toBe("consultation-1");
    expect(result.estimatedN).toBe(25);
    expect(result.byRegion[0]).toMatchObject({region:"SP",estimatedN:25,monthlyEligible:null});
    expect(result.monthsToFill).toBeNull();
    expect(result.proprietaryFindingTotal).toBe(7);
  });
});
