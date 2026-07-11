/**
 * Client for the Python feasibility estimator (FastAPI, DataSUS/OMOP over DuckDB).
 *
 * The sponsor journey's NATIONAL feasibility numbers come from this service — a
 * standardized estimate over the DataSUS national base, complementary to the
 * per-site response counts. The estimator owns its data source; this is a thin,
 * timeout-guarded HTTP client that returns null when the service is unreachable
 * so the sponsor page degrades gracefully instead of erroring.
 *
 * Base URL: TB_ESTIMATOR_URL (default http://127.0.0.1:8421 — see the root
 * .claude/launch.json `estimator-api` config and outputs/trialbridge_estimator).
 *
 * DATA-SOURCE / FALLBACK NOTE: the estimator reads TB_DATASUS_DIR. Point it at
 * data/omop_sample (213MB, ships in the repo) for a fast local run — a real but
 * thin subset, so the national cohort can be small or zero. The full national
 * figure (~4,588 eligible for the HER2+ hero protocol, per the estimator README)
 * requires TB_DATASUS_DIR=…/omop_full (163GB, not shipped). `dataSource` and
 * `baseCohort` below let the UI state which base produced the number.
 */

const BASE_URL = process.env.TB_ESTIMATOR_URL ?? "http://127.0.0.1:8421";
const TIMEOUT_MS = 8000;

/**
 * Shared-secret bearer token for the estimator's access gate. Optional: when unset
 * (local dev, or before the gate is enabled) no auth header is sent and the open
 * estimator answers normally. When the estimator has TB_ESTIMATOR_TOKEN set, this
 * must match or requests get 401.
 *
 * Server-side only — read from process.env with no NEXT_PUBLIC_ prefix, so it is never
 * bundled to the browser. fetchNationalEstimate() must stay server-side (server
 * component / route handler); called from a client component, process.env is undefined
 * and the header is dropped -> 401. Trimmed to match the estimator, which strips the
 * env value (a stray newline/space pasted into the Render dashboard would otherwise 401).
 */
const ESTIMATOR_TOKEN = process.env.TB_ESTIMATOR_TOKEN?.trim();

function estimatorHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ESTIMATOR_TOKEN) h["Authorization"] = `Bearer ${ESTIMATOR_TOKEN}`;
  return h;
}

export interface RegionEstimate {
  /** 2-letter UF code (SP, MG, …) — the estimator reports at state granularity. */
  region: string;
  estimatedN: number;
  ciLo: number;
  ciHi: number;
  baseCohort: number;
  /** Eligible patients arriving per month in this UF (incidence × eligibility), when reported. */
  monthlyEligible: number | null;
}

/** A protocol-softening lever measured over the real base cohort. */
export interface EstimatorBottleneck {
  criterionId: string;
  text: string;
  /** Additional base-cohort patients admitted if this criterion is relaxed. */
  gain: number;
}

export interface NationalEstimate {
  protocolId: string;
  estimatedN: number;
  ciLo: number;
  ciHi: number;
  baseCohort: number;
  byRegion: RegionEstimate[];
  monthsToFill: number | null;
  /** Direct row-level count of eligible patients across sites with real data. */
  observedTotal: number;
  /** How many sites contributed real row-level data to the observed count. */
  sitesWithData: number;
  /** Which DataSUS base produced this (for the honest UI label). */
  dataSource: string;
  /** Dataset date of the DataSUS base, when the estimator reports it. */
  asOf: string | null;
  /** Criterion-relaxation gains over the real base cohort (softening levers). */
  bottlenecks: EstimatorBottleneck[];
}

interface RawEstimate {
  protocol_id: string;
  national_estimated_n: number;
  national_ci_lo: number;
  national_ci_hi: number;
  national_base_cohort: number;
  by_region?: {
    region: string;
    // Materialized bases report `est_eligible`; older builds reported `estimated_n`.
    est_eligible?: number;
    estimated_n?: number;
    ci_lo: number;
    ci_hi: number;
    base_cohort: number;
  }[];
  national_months_to_fill?: number | null;
  observed_by_site?: { site: string; n_patients: number; observed_n: number }[];
  bottlenecks?: { criterion_id: string; text: string; gain: number }[];
  fill_speed_by_region?: { region: string; monthly_eligible: number }[];
  datasus_source?: string;
  datasus_as_of?: string;
}

async function withTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch the national feasibility estimate for the estimator's loaded protocol.
 * Returns null if the estimator is unreachable, times out, or errors — callers
 * render an "estimator offline" state rather than failing the page.
 */
export async function fetchNationalEstimate(): Promise<NationalEstimate | null> {
  try {
    const res = await withTimeout(`${BASE_URL}/feasibility/estimate`, {
      method: "POST",
      headers: estimatorHeaders(),
      body: "{}",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const d = (await res.json()) as RawEstimate;
    const observed = d.observed_by_site ?? [];
    const monthlyByUf = new Map(
      (d.fill_speed_by_region ?? []).map((r) => [r.region, r.monthly_eligible]),
    );
    return {
      protocolId: d.protocol_id,
      estimatedN: d.national_estimated_n,
      ciLo: d.national_ci_lo,
      ciHi: d.national_ci_hi,
      baseCohort: d.national_base_cohort,
      byRegion: (d.by_region ?? []).map((r) => ({
        region: r.region,
        estimatedN: r.est_eligible ?? r.estimated_n ?? 0,
        ciLo: r.ci_lo,
        ciHi: r.ci_hi,
        baseCohort: r.base_cohort,
        monthlyEligible: monthlyByUf.get(r.region) ?? null,
      })),
      monthsToFill: d.national_months_to_fill ?? null,
      observedTotal: observed.reduce((s, o) => s + o.observed_n, 0),
      sitesWithData: observed.length,
      // Prefer the service's own label (the materialized bases report which base
      // actually answered) over the deploy-time env hint.
      dataSource: d.datasus_source ?? process.env.TB_DATASUS_LABEL ?? "DataSUS/OMOP (omop_sample)",
      asOf: d.datasus_as_of ?? null,
      bottlenecks: (d.bottlenecks ?? []).map((b) => ({
        criterionId: b.criterion_id,
        text: b.text,
        gain: b.gain,
      })),
    };
  } catch {
    return null;
  }
}

export function estimatorConfigured(): { baseUrl: string } {
  return { baseUrl: BASE_URL };
}
