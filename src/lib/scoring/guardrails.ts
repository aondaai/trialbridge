/**
 * Guard-rails — hard flags that override the composite (engineering spec §6.7,
 * scorecard §10.3). A composite mean can hide a showstopper (a great pool at a site
 * that owns no PET-CT, or a chronic zero-enroller). These detectors surface such
 * conditions as `HardFlag`s and the scorer demotes a flagged site so it can never
 * out-rank a clean one, regardless of raw components.
 */

import { Confidence, modeled } from "@/lib/metric";
import { HardFlag } from "@/lib/scoring/types";

/** Ceiling a demoted site's composite is capped to — below any plausible top-decile. */
export const DEMOTION_CEILING = 35;

export interface GuardrailContext {
  zeroEnroller: boolean;
  infraFitPct: number; // 0..100
  minInfraFit: number; // 0..100 threshold from the protocol profile
  cepAccreditedForRisk: boolean;
  impLeadTimeDays: number;
  daysToFpiBudget: number;
}

/** Detect all active hard flags for a site. */
export function detectHardFlags(ctx: GuardrailContext): HardFlag[] {
  const flags: HardFlag[] = [];

  if (ctx.zeroEnroller) {
    flags.push({
      key: "chronic_zero_enroller",
      label: "Chronic zero-enroller",
      severity: "demote",
      detailMetric: modeled("site.flag.zero_enroller", 1, Confidence.MEDIUM, {
        note: "Prior trials at this site/PI enrolled zero — the single strongest predictor of failure.",
      }),
    });
  }

  if (ctx.infraFitPct < ctx.minInfraFit) {
    flags.push({
      key: "missing_essential_equipment",
      label: "Missing essential equipment",
      severity: "demote",
      detailMetric: modeled("site.flag.infra_fit", Math.round(ctx.infraFitPct), Confidence.HIGH, {
        unit: "%",
        note: `Infra-fit ${Math.round(ctx.infraFitPct)}% is below the protocol minimum ${ctx.minInfraFit}%.`,
      }),
    });
  }

  if (!ctx.cepAccreditedForRisk) {
    flags.push({
      key: "cep_not_accredited_for_risk",
      label: "CEP not accredited for the study risk level",
      severity: "demote",
      detailMetric: modeled("site.flag.cep", 0, Confidence.MEDIUM, {
        note: "Coordinating CEP is not credentialed for this study's risk tier.",
      }),
    });
  }

  if (ctx.impLeadTimeDays > ctx.daysToFpiBudget) {
    flags.push({
      key: "import_window_incompatible",
      label: "IMP import window incompatible with the timeline",
      severity: "demote",
      detailMetric: modeled("site.flag.import_window", ctx.impLeadTimeDays, Confidence.MEDIUM, {
        unit: "days",
        note: `IMP lead time ${ctx.impLeadTimeDays}d exceeds the ${ctx.daysToFpiBudget}d budget to FPI.`,
      }),
    });
  }

  return flags;
}

/** Apply demotion: a site with any hard flag is capped below top-decile territory. */
export function applyDemotion(rawComposite: number, flags: HardFlag[]): number {
  if (flags.length === 0) return rawComposite;
  if (flags.some((f) => f.severity === "block")) return 0;
  return Math.min(rawComposite, DEMOTION_CEILING);
}
