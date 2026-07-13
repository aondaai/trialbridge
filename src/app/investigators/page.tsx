import { TopBar } from "@/components/ui";
import { KolDirectoryTable } from "@/components/KolDirectoryTable";
import { loadInvestigatorDirectory } from "@/lib/kol/directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function InvestigatorsPage() {
  const directory = loadInvestigatorDirectory();
  const { summary } = directory;
  return (
    <>
      <TopBar active="investigators" />
      <main className="wrap kol-page">
        <div className="reports-page-head">
          <div>
            <h1 style={{ marginBottom: 2 }}>KOLs / PIs</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Confirmed site investigators, Brazil CT.gov registry investigators and separately labeled public-evidence candidates.
            </p>
          </div>
          {(directory.generatedAt || directory.ctgovGeneratedAt) && <span className="kol-generated muted">Master {directory.generatedAt?.slice(0, 10) ?? "—"} · CT.gov {directory.ctgovGeneratedAt?.slice(0, 10) ?? "—"}</span>}
        </div>

        <div className="kol-boundary-note">
          <strong>Identity boundary:</strong> “Confirmed PI” means the professional appears in the ABRACRO roster for that center; it does not assert current availability. “CT.gov investigator” confirms a person–trial relationship, not a person–site relationship. “KOL evidence” comes from cited public-web research.
        </div>

        {!directory.rosterAvailable && (
          <div className="card kol-data-warning">
            <strong>The restricted ABRACRO roster is not mounted in this environment.</strong>
            <span>Run <code>npm run build-facility-master</code> or configure <code>TB_FACILITY_MASTER_DB</code> to load confirmed PIs.</span>
          </div>
        )}
        {!directory.ctgovGeneratedAt && (
          <div className="card kol-data-warning">
            <strong>The materialized Brazil CT.gov roster is not mounted in this environment.</strong>
            <span>Run <code>npm run build-ctgov-investigator-roster</code> or configure <code>TB_CTGOV_INVESTIGATOR_ROSTER</code>.</span>
          </div>
        )}

        <section className="kol-summary" aria-label="KOL and PI directory summary">
          <div className="card"><span className="stat small">{summary.confirmedPis}</span><span>Confirmed PIs</span><small>ABRACRO roster</small></div>
          <div className="card"><span className="stat small">{summary.piFacilityLinks}</span><span>PI–center links</span><small>{summary.researchFacilities} research centers</small></div>
          <div className="card"><span className="stat small">{summary.ctgovInvestigatorProfiles}</span><span>CT.gov investigators</span><small>{summary.ctgovTrialLinks} person–trial links · {summary.ctgovMatchedToConfirmedPis} linked to ABRACRO</small></div>
          <div className="card"><span className="stat small">{summary.profilesWithPublicEvidence}</span><span>KOL evidence</span><small>{summary.parallelProfiles} Parallel profiles · {summary.matchedParallelProfiles} matched</small></div>
        </section>

        <KolDirectoryTable entries={directory.entries} />
      </main>
    </>
  );
}
