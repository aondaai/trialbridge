import { NextResponse } from "next/server";
import { loadFacilityReportView } from "@/lib/facilities/loadMasterView";

export const dynamic = "force-dynamic";

const FIELD_LABELS: Record<string, string> = {
  "research.therapeutic_areas": "Therapeutic areas",
  "research.oncology_experience": "Oncology experience",
  "research.edc_experience": "EDC experience",
  "research.rbm_experience": "RBM experience",
  "research.central_lab_exams": "Central laboratory — tests",
  "research.central_lab_imaging": "Central laboratory — imaging",
  "research.cep_name": "Ethics committee",
  "research.roster_investigators": "Investigators on roster",
  "research.roster_coordinators": "Coordinators on roster",
  "inspection.anvisa": "Declared ANVISA inspection",
  "inspection.fda": "Declared FDA inspection",
  "inspection.ema": "Declared EMA inspection",
  "official.facility_type": "Official facility type",
};

export async function GET(_: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const view = loadFacilityReportView();
  const facility = view.facilities.find((item) => item.facilityId === `fac-${siteId}`);
  if (!facility) return NextResponse.json({ facility: null });

  const evidence = facility.observations
    .filter((item) => FIELD_LABELS[item.field])
    .map((item) => ({
      field: item.field,
      label: FIELD_LABELS[item.field],
      value: item.value,
      assertion: item.assertion,
      sourceClass: item.sourceClass,
      observedAt: item.observedAt,
    }));

  return NextResponse.json({
    facility: {
      facilityId: facility.facilityId,
      name: facility.name,
      officialName: facility.officialName,
      cnes: facility.cnes,
      city: facility.city,
      uf: facility.uf,
      activityStatus: facility.activityStatus,
      sources: facility.sources,
      trialCount: facility.trialCount,
      activeTrialCount: facility.activeTrialCount,
      aliases: facility.aliases.slice(0, 8),
      evidence,
      masterGeneratedAt: view.generatedAt,
    },
  });
}
