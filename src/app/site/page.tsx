import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadSite } from "@/lib/data/sites";
import { getConsultation, loadResponses } from "@/lib/store";
import { evaluateDataset } from "@/lib/service";
import { HERO_META } from "@/data/hero-protocol";
import { loadRenderAnswers } from "@/lib/feasibility-autofill/persist";
import { TopBar, PrivacyBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

// Camila's demo identities. The structured-DB / OMOP deliverable is anchored on
// her live site (site-a); the feasibility demo runs on the iHealth demo site.
const SITE_ID = "site-a";
const FEASIBILITY_SITE_ID = "site-ihealth-demo";

export default async function SiteHub() {
  // Live signals — each guarded so the hub renders on a totally empty DB too.
  const ds = await loadSite(SITE_ID).catch(() => null);
  const patientCount = ds?.patients.length ?? 0;

  const consultation = await getConsultation(HERO_META.id).catch(() => undefined);
  let matchSummary: { total: number; definite: number; possible: number } | null = null;
  let alreadySubmitted = false;
  if (ds && consultation) {
    const evaluated = evaluateDataset(ds, consultation.criteria);
    matchSummary = {
      total: evaluated.counts.total,
      definite: evaluated.counts.definite,
      possible: evaluated.counts.possible,
    };
    const responses = await loadResponses(consultation.id).catch(() => []);
    alreadySubmitted = responses.some((r) => r.siteId === SITE_ID);
  }

  const requests = await prisma.feasibilityRequest
    .findMany({ where: { siteId: FEASIBILITY_SITE_ID }, orderBy: { createdAt: "desc" } })
    .catch(() => []);
  const latestRequest = requests[0] ?? null;
  const feasibilityAnswers = latestRequest ? await loadRenderAnswers(latestRequest.id).catch(() => []) : [];
  const feasibilityApproved = feasibilityAnswers.filter((a) => a.status === "approved").length;

  return (
    <>
      <TopBar active="site" />
      <main className="wrap">
        <h1 style={{ marginBottom: 2 }}>Your site — Dra. Camila Rocha</h1>
        <p className="muted" style={{ marginTop: 0, maxWidth: 680 }}>
          Two things TrialBridge does for your center, from the data you already have.
          Patient records stay here — sponsors only ever see aggregate counts.
        </p>

        <PrivacyBanner variant="site" />

        {/* ---- Deliverable 1: structured database + OMOP ---- */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="tb-stat tb-stat--sm" style={{ color: "var(--brand)" }}>1</span>
            <h2 style={{ margin: 0 }}>Structured database + OMOP</h2>
          </div>
          <p className="sub">
            Upload the data you have — messy CSV or EHR export — and we structure it into a clean,
            clinical-trial-ready patient database, then code it to the OMOP Common Data Model
            (concepts, vocabularies, CDM tables). Two deliverables: a structured DB and an OMOP DB.
          </p>

          {patientCount > 0 ? (
            <div className="grid2" style={{ margin: "8px 0 12px" }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Structured patient records</div>
                <div className="tb-stat" style={{ color: "var(--definite)" }}>{patientCount}</div>
                <div className="muted" style={{ fontSize: 12 }}>{ds?.site.name}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Coded to OMOP CDM</div>
                <div className="tb-stat" style={{ color: "var(--brand)" }}>ready</div>
                <div className="muted" style={{ fontSize: 12 }}>concepts · vocabularies · CDM tables</div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              No data uploaded yet — start by listing your site and dropping an export.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <Link href="/site/new" className="cl-btn cl-btn--primary no-print">
              {patientCount > 0 ? "Upload / re-structure data →" : "Upload data →"}
            </Link>
            {patientCount > 0 && (
              <Link href="/site/database" className="cl-btn cl-btn--secondary no-print">
                View structured DB + OMOP →
              </Link>
            )}
          </div>
        </div>

        {/* ---- Deliverable 2: feasibility autofill (multi-agent) ---- */}
        <div className="card">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="tb-stat tb-stat--sm" style={{ color: "var(--brand)" }}>2</span>
            <h2 style={{ margin: 0 }}>Feasibility autofill — multi-agent</h2>
          </div>
          <p className="sub">
            Drop a pharma feasibility questionnaire and our multi-agent architecture fills it,
            field by field: A (site profile) and B (capabilities) and C (candidate cohort) are
            deterministic; D drafts narrative answers with an adversarial critic. You review and
            approve — D is never auto-approved — then export a .docx.
          </p>

          {latestRequest ? (
            <div className="grid2" style={{ margin: "8px 0 12px" }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Latest request</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{latestRequest.studyTitle}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {latestRequest.sponsorId} · {feasibilityAnswers.length} fields autofilled
                  {feasibilityApproved > 0 ? ` · ${feasibilityApproved} approved` : ""}
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>Inbox</div>
                <div className="tb-stat" style={{ color: "var(--brand)" }}>{requests.length}</div>
                <div className="muted" style={{ fontSize: 12 }}>request{requests.length === 1 ? "" : "s"} received</div>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              No feasibility request yet — open the workspace to drop a sponsor form.
            </p>
          )}

          <div style={{ marginTop: 4 }}>
            <Link href="/site/feasibility" className="cl-btn cl-btn--primary no-print">
              Open feasibility workspace →
            </Link>
          </div>
        </div>

        {/* ---- Secondary: respond to an open sponsor consultation ---- */}
        <div className="card">
          <h2 style={{ margin: 0 }}>Respond to a sponsor consultation</h2>
          <p className="sub">
            When a sponsor posts a protocol, match it privately against your patients and submit
            proof of capacity — aggregate counts only, no rows leave your site.
          </p>
          {matchSummary ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Open: <strong>{consultation?.title}</strong> — {matchSummary.definite} confirmed /{" "}
              {matchSummary.possible} possible across {matchSummary.total} records
              {alreadySubmitted ? " · submitted ✓" : ""}.
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>No open consultation right now.</p>
          )}
          <div style={{ marginTop: 4 }}>
            <Link href="/site/respond" className="cl-btn cl-btn--secondary no-print">
              {alreadySubmitted ? "Review your response →" : "Match & respond →"}
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
