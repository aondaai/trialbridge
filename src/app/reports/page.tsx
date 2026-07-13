import Link from "next/link";
import { TopBar } from "@/components/ui";
import { loadConsultations } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  running: "Building",
  complete: "Ready",
  partial: "Ready · partial coverage",
  failed: "Fallback available",
};

export default async function ReportsPage() {
  const reports = [...await loadConsultations()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <TopBar active="reports" />
      <main className="wrap">
        <div className="reports-page-head">
          <div>
            <h1 style={{ marginBottom: 2 }}>Reports</h1>
            <p className="muted" style={{ marginTop: 0 }}>
              Every posted consultation becomes a feasibility report and remains available here.
            </p>
          </div>
          <Link href="/sponsor/new" className="cl-btn cl-btn--primary no-print">+ New consultation</Link>
        </div>

        {reports.length === 0 ? (
          <div className="card">
            <h2>No reports yet</h2>
            <p className="sub">Post a protocol to create the first feasibility report.</p>
            <Link href="/sponsor/new">Post a consultation →</Link>
          </div>
        ) : (
          <div className="card reports-card">
            <div className="table-scroll">
              <table className="data reports-table">
                <colgroup>
                  <col className="reports-col-created" />
                  <col className="reports-col-protocol" />
                  <col className="reports-col-reference" />
                  <col className="reports-col-status" />
                  <col className="reports-col-action" />
                </colgroup>
                <thead><tr><th>Created</th><th>Protocol</th><th>Reference</th><th>Status</th><th className="reports-action">Action</th></tr></thead>
                <tbody>
                  {reports.map((report) => {
                    const status = report.reportRun?.status ?? report.estimateStatus ?? "pending";
                    return (
                      <tr key={report.id}>
                        <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{report.createdAt.slice(0, 10)}</td>
                        <td className="reports-protocol"><strong>{report.title}</strong><br /><span className="muted">{report.sponsorName}</span></td>
                        <td className="mono muted">{report.nct || "—"}</td>
                        <td>{STATUS_LABEL[status] ?? status}</td>
                        <td className="reports-action">
                          <Link
                            href={`/reports/${encodeURIComponent(report.id)}`}
                            className="cl-btn cl-btn--primary cl-btn--sm"
                            aria-label={`View report: ${report.title}`}
                          >
                            View report <span aria-hidden="true">→</span>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
