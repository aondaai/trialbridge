"use client";

import { useMemo, useState } from "react";
import type { InvestigatorDirectoryEntry } from "@/lib/kol/directoryModel";

const PAGE_SIZE = 50;

function evidenceText(entry: InvestigatorDirectoryEntry): string {
  const signals: Array<string | null> = [
    entry.ctgovTrialCount > 0 ? `${entry.ctgovTrialCount} CT.gov ${entry.ctgovTrialCount === 1 ? "study" : "studies"}` : null,
    entry.pubsCountTa != null ? `${entry.pubsCountTa} publications` : null,
    entry.societyRoles.length ? entry.societyRoles.join(", ") : null,
    entry.guidelineAuthor ? "guideline author" : null,
  ];
  if (entry.evidenceStatus === "researched_no_positive_signal") signals.push("no positive Parallel signal");
  return signals.filter(Boolean).join(" · ") || "Not yet researched";
}

export function KolDirectoryTable({ entries }: { entries: InvestigatorDirectoryEntry[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "pis" | "ctgov" | "parallel" | "evidence">("all");
  const [uf, setUf] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const ufs = useMemo(() => [...new Set(entries.flatMap((entry) => entry.facilities.map((facility) => facility.uf)).filter((value): value is string => Boolean(value)))].sort(), [entries]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return entries.filter((entry) => {
      if (filter === "pis" && entry.kind !== "confirmed_pi") return false;
      if (filter === "ctgov" && entry.kind !== "ctgov_investigator") return false;
      if (filter === "parallel" && entry.kind !== "parallel_candidate") return false;
      if (filter === "evidence" && entry.evidenceStatus !== "public_evidence") return false;
      if (uf !== "all" && !entry.facilities.some((facility) => facility.uf === uf)) return false;
      if (!needle) return true;
      const searchable = [
        entry.name,
        ...entry.societyRoles,
        ...entry.ctgovRoles,
        ...entry.ctgovAffiliations,
        ...entry.ctgovNctIds,
        ...entry.facilities.flatMap((facility) => [facility.name, facility.city ?? "", facility.uf ?? "", facility.cnes ?? ""]),
      ].join(" ").toLocaleLowerCase("pt-BR");
      return searchable.includes(needle);
    });
  }, [entries, filter, query, uf]);
  const visible = filtered.slice(0, limit);

  return (
    <>
      <div className="kol-filters no-print" aria-label="KOL and PI directory filters">
        <label className="kol-filter-search">
          <span>Search</span>
          <input
            className="cl-input"
            value={query}
            placeholder="Name, affiliation, center, NCT, CNES or society"
            onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
          />
        </label>
        <label>
          <span>Profile</span>
          <select className="cl-select" value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setLimit(PAGE_SIZE); }}>
            <option value="all">All profiles</option>
            <option value="pis">Confirmed PIs</option>
            <option value="ctgov">CT.gov investigators</option>
            <option value="evidence">Public KOL evidence</option>
            <option value="parallel">Parallel-only candidates</option>
          </select>
        </label>
        <label>
          <span>State</span>
          <select className="cl-select" value={uf} onChange={(event) => { setUf(event.target.value); setLimit(PAGE_SIZE); }}>
            <option value="all">All states</option>
            {ufs.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <div className="kol-result-count muted" aria-live="polite">
        Showing {Math.min(visible.length, filtered.length)} of {filtered.length} matching profiles
      </div>

      <div className="card kol-directory-card">
        <div className="table-scroll">
          <table className="data kol-directory-table">
            <thead>
              <tr><th>Investigator</th><th>Classification</th><th>Research center</th><th>Public evidence</th></tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.personId}>
                  <td className="kol-person-cell">
                    <strong>{entry.name}</strong>
                    <span className="muted">{entry.sources.join(" + ")}</span>
                  </td>
                  <td>
                    <span className={`cl-badge ${entry.kind === "confirmed_pi" ? "cl-badge--success" : entry.kind === "ctgov_investigator" ? "cl-badge--info" : "cl-badge--warning"}`}>
                      {entry.kind === "confirmed_pi" ? "Confirmed PI" : entry.kind === "ctgov_investigator" ? "CT.gov investigator" : "Unlinked candidate"}
                    </span>
                    {entry.kind === "confirmed_pi" && entry.ctgovTrialCount > 0 && <span className="cl-badge cl-badge--info">CT.gov linked</span>}
                    {entry.evidenceStatus === "public_evidence" && <span className="cl-badge cl-badge--accent">KOL evidence</span>}
                  </td>
                  <td className="kol-facility-cell">
                    {entry.facilities.length === 0 ? (
                      entry.ctgovAffiliations.length > 0 ? <div><strong>{entry.ctgovAffiliations[0]}</strong><span className="muted">Registry affiliation · facility link not confirmed</span></div> : <span className="muted">No confirmed facility link</span>
                    ) : entry.facilities.slice(0, 2).map((facility) => (
                      <div key={facility.facilityId}>
                        <strong>{facility.name}</strong>
                        <span className="muted">
                          {[facility.city, facility.uf].filter(Boolean).join(" · ") || "Location unavailable"}
                          {facility.cnes && <> · <span className={facility.cnesStatus === "confirmed" ? "kol-cnes-confirmed" : "kol-cnes-unverified"}>CNES {facility.cnes}{facility.cnesStatus === "unverified" ? " · unverified" : ""}</span></>}
                        </span>
                      </div>
                    ))}
                    {entry.facilities.length > 2 && <span className="muted">+{entry.facilities.length - 2} additional centers</span>}
                  </td>
                  <td className="kol-evidence-cell">
                    <span>{evidenceText(entry)}</span>
                    {entry.ctgovRoles.length > 0 && <span className="muted">Registry role: {entry.ctgovRoles.join(", ").replaceAll("_", " ")}</span>}
                    {entry.ctgovNctIds.length > 0 && <span><a href={`https://clinicaltrials.gov/study/${entry.ctgovNctIds[0]}`} target="_blank" rel="noopener noreferrer">View CT.gov</a>{entry.ctgovNctIds.length > 1 && <span className="muted"> +{entry.ctgovNctIds.length - 1}</span>}</span>}
                    {entry.confidence && <span className="muted">Parallel confidence: {entry.confidence}</span>}
                    {entry.citations.find((citation) => citation.url) && (
                      <span>
                        <a href={entry.citations.find((citation) => citation.url)!.url!} target="_blank" rel="noopener noreferrer">View public source</a>
                        {entry.citations.length > 1 && <span className="muted"> +{entry.citations.length - 1}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 28 }}>No profiles match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {visible.length < filtered.length && (
        <div className="kol-load-more no-print">
          <button className="cl-btn cl-btn--secondary" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
          </button>
        </div>
      )}
    </>
  );
}
