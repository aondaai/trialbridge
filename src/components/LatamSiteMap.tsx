"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  clusterBrazilSites,
  filterBrazilSites,
  isDefensibleActiveCenter,
  type BrazilSiteFilters,
  type BrazilTrialSite,
  type IntelligenceScope,
  type SiteCluster,
} from "@/lib/map/brazil-sites";

interface Payload {
  schema_version: string;
  generated_at: string;
  master_generated_at: string;
  dedup: {
    method: string;
    input_sites: number;
    output_sites: number;
    merged_groups: number;
    provisional_sites: number;
  };
  sites: BrazilTrialSite[];
}

interface FacilityDetail {
  facilityId: string;
  name: string;
  officialName: string;
  cnes: string | null;
  city: string | null;
  uf: string | null;
  activityStatus: string;
  sources: string[];
  trialCount: number;
  activeTrialCount: number;
  aliases: string[];
  masterGeneratedAt: string;
  evidence: Array<{
    field: string;
    label: string;
    value: unknown;
    assertion: string;
    sourceClass: string;
    observedAt: string | null;
  }>;
}

const DEFAULT_FILTERS: BrazilSiteFilters = {
  query: "",
  activity: "active",
  uf: "",
  minActiveTrials: 0,
  scope: "research_network",
  identity: "identified",
};

const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso",
  MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina",
  SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

const SCOPE_LABELS: Array<{ value: IntelligenceScope; label: string }> = [
  { value: "all", label: "All" },
  { value: "research_network", label: "ABRACRO / ACESSE" },
  { value: "oncology", label: "Oncology" },
  { value: "inspection", label: "With inspection" },
];

function MapZoom({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

function ClusterLayer({ clusters, onSelect }: { clusters: SiteCluster[]; onSelect: (site: BrazilTrialSite) => void }) {
  const map = useMap();
  return clusters.map((cluster) => {
    const isCluster = cluster.count > 1;
    const radius = isCluster ? Math.min(24, 7 + Math.log2(cluster.count) * 2.4) : 5;
    const site = cluster.site;
    const active = site?.activity_status === "active" || cluster.activeCount > 0;
    const color = active ? "#1f9d6b" : "#9b9a94";
    return (
      <CircleMarker
        key={cluster.id}
        center={[cluster.lat, cluster.lng]}
        radius={radius}
        pathOptions={{
          color: isCluster ? "#fff" : color,
          fillColor: isCluster ? "#d86f45" : color,
          fillOpacity: isCluster ? 0.88 : 0.72,
          weight: isCluster ? 2 : 1,
        }}
        eventHandlers={{
          click: () => {
            if (site) onSelect(site);
            else map.flyTo([cluster.lat, cluster.lng], Math.min(map.getZoom() + 2, 9), { duration: 0.5 });
          },
        }}
      >
        {isCluster ? (
          <Tooltip permanent direction="center" className="br-cluster-label">
            {cluster.count.toLocaleString("en-US")}
          </Tooltip>
        ) : site ? (
          <Tooltip direction="top" offset={[0, -6]}>
            <strong>{site.name}</strong><br />
            {[site.city, site.uf].filter(Boolean).join(" · ")}<br />
            {site.active_trial_count} active trials · {site.trial_count} historical
          </Tooltip>
        ) : null}
      </CircleMarker>
    );
  });
}

function formatEvidenceValue(value: unknown, assertion: string): string {
  if (assertion === "unknown" || value == null || value === "") return "Not reported";
  if (assertion === "yes" || value === true) return "Yes";
  if (assertion === "no" || value === false) return "No";
  if (Array.isArray(value)) return value.join(", ") || "Not reported";
  return String(value);
}

function SourceBadge({ source }: { source: string }) {
  const label: Record<string, string> = {
    sitemap: "CT.gov / ReBEC", abracro: "ABRACRO", acesse: "ACESSE", omop_care_site: "CNES / OMOP",
  };
  return <span className={`br-source br-source--${source}`}>{label[source] ?? source}</span>;
}

function SiteDetailPanel({ site, onClose }: { site: BrazilTrialSite; onClose: () => void }) {
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    fetch(`/api/map/sites/${encodeURIComponent(site.site_id)}`)
      .then((response) => response.json())
      .then((data: { facility?: FacilityDetail | null }) => { if (!cancelled) setDetail(data.facility ?? null); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [site.site_id]);

  const sources = detail?.sources ?? site.intelligence?.sources ?? site.discovered_via;
  return (
    <aside className="br-site-panel" aria-label="Site intelligence">
      <div className="br-site-panel__head">
        <div>
          <span className="eyebrow">Selected site</span>
          <h2>{detail?.name ?? site.name}</h2>
          <p>{[detail?.city ?? site.city, detail?.uf ?? site.uf].filter(Boolean).join(" · ") || "Location not normalized"}</p>
        </div>
        <button className="br-close" onClick={onClose} aria-label="Close panel">×</button>
      </div>

      <div className="br-site-panel__scroll">
        <div className="br-status-row">
          <span className={`br-status br-status--${site.activity_status}`}>{site.activity_status === "active" ? "Active" : "Historical"}</span>
          <span className="br-precision">{site.identity_status === "provisional" ? "Provisional identity · " : ""}Approximate coordinates · city level</span>
        </div>

        <div className="br-kpi-grid">
          <div><strong>{site.active_trial_count}</strong><span>active trials</span></div>
          <div><strong>{site.trial_count}</strong><span>historical trials</span></div>
          <div><strong>{detail?.cnes ?? site.intelligence?.cnes ?? "—"}</strong><span>CNES</span></div>
        </div>

        {site.trial_refs.length > 0 && (
          <section className="br-detail-section">
            <h3>Registered trials</h3>
            <div className="br-tag-row">
              {site.trial_refs.slice(0, 8).map((trial) => <span className="br-trial" key={trial}>{trial}</span>)}
              {site.trial_count > site.trial_refs.length && <span className="br-more">+{site.trial_count - site.trial_refs.length}</span>}
            </div>
          </section>
        )}

        <section className="br-detail-section">
          <h3>Identity and capability sources</h3>
          <div className="br-tag-row">
            {sources.length ? sources.map((source) => <SourceBadge key={source} source={source} />) : <span className="muted">No materialized source</span>}
          </div>
          <p className="br-evidence-note">Declared fields and government records remain separate; lack of evidence is not treated as lack of capability.</p>
        </section>

        {loading ? <div className="br-panel-loading">Loading facility master evidence…</div> : detail?.evidence.length ? (
          <section className="br-detail-section">
            <h3>Capability and maturity</h3>
            <div className="br-evidence-list">
              {detail.evidence.map((item) => (
                <div key={item.field} className="br-evidence-item">
                  <div><strong>{item.label}</strong><span>{formatEvidenceValue(item.value, item.assertion)}</span></div>
                  <small>{item.sourceClass === "official" ? "Official source" : "Declared source"}{item.observedAt ? ` · ${new Date(item.observedAt).toLocaleDateString("en-US")}` : ""}</small>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="br-detail-section br-empty-evidence">
            <h3>Capability and maturity</h3>
            <p>No structured evidence is available for this site yet. Its map record confirms trial presence, not current operational capability.</p>
          </section>
        )}

        {detail?.aliases && detail.aliases.length > 1 && (
          <section className="br-detail-section">
            <h3>Resolved aliases</h3>
            <p className="br-aliases">{detail.aliases.join(" · ")}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

export default function LatamSiteMap() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BrazilSiteFilters>(DEFAULT_FILTERS);
  const [view, setView] = useState<"map" | "dataset">("map");
  const [zoom, setZoom] = useState(4);
  const [selected, setSelected] = useState<BrazilTrialSite | null>(null);

  useEffect(() => {
    fetch("/data/brazil-sites.json")
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((data: Payload) => setPayload(data))
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const sites = payload?.sites ?? [];
  const visible = useMemo(() => filterBrazilSites(sites, filters), [sites, filters]);
  const clusters = useMemo(() => clusterBrazilSites(visible, zoom), [visible, zoom]);
  const ufs = useMemo(() => [...new Set(sites.map((site) => site.uf).filter((uf): uf is string => Boolean(uf)))].sort(), [sites]);
  const defensibleActiveCenters = useMemo(() => sites.filter(isDefensibleActiveCenter).length, [sites]);
  const tableRows = useMemo(() => [...visible].sort((a, b) => b.active_trial_count - a.active_trial_count || b.trial_count - a.trial_count).slice(0, 500), [visible]);

  function patchFilters(patch: Partial<BrazilSiteFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setSelected(null);
  }

  return (
    <div className="br-intelligence">
      <div className="br-summary br-summary--single">
        <div>
          <strong>{defensibleActiveCenters.toLocaleString("en-US")}</strong>
          <span>centers with active studies and corroborating ABRACRO / ACESSE evidence</span>
        </div>
      </div>

      <div className="br-toolbar">
        <div className="br-view-switch" aria-label="View">
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}>Map</button>
          <button className={view === "dataset" ? "active" : ""} onClick={() => setView("dataset")}>Dataset</button>
        </div>
        <label className="br-search">
          <span>⌕</span>
          <input value={filters.query} onChange={(event) => patchFilters({ query: event.target.value })} placeholder="Search site, city, or CNES" />
        </label>
        <select aria-label="State" value={filters.uf} onChange={(event) => patchFilters({ uf: event.target.value })}>
          <option value="">All states</option>
          {ufs.map((uf) => <option value={uf} key={uf}>{uf} · {UF_NAMES[uf]}</option>)}
        </select>
        <select aria-label="Activity" value={filters.activity} onChange={(event) => patchFilters({ activity: event.target.value as BrazilSiteFilters["activity"] })}>
          <option value="active">With active trials</option>
          <option value="all">Active + historical</option>
          <option value="dormant">Historical only</option>
        </select>
        <select aria-label="Minimum active trials" value={filters.minActiveTrials} onChange={(event) => patchFilters({ minActiveTrials: Number(event.target.value) })}>
          <option value={0}>Any volume</option>
          <option value={1}>1+ active trial</option>
          <option value={3}>3+ active trials</option>
          <option value={10}>10+ active trials</option>
        </select>
        <select aria-label="Identity quality" value={filters.identity} onChange={(event) => patchFilters({ identity: event.target.value as BrazilSiteFilters["identity"] })}>
          <option value="identified">Identified sites</option>
          <option value="all">Include provisional</option>
          <option value="provisional">Provisional only</option>
        </select>
      </div>

      <div className="br-scopebar">
        <span>Scope</span>
        {SCOPE_LABELS.map((scope) => (
          <button key={scope.value} className={filters.scope === scope.value ? "active" : ""} onClick={() => patchFilters({ scope: scope.value })}>{scope.label}</button>
        ))}
        <em>{visible.length.toLocaleString("en-US")} sites in view</em>
      </div>

      {loadError && <p className="map-error">Could not load the map: {loadError}</p>}
      <div className={`br-content ${selected ? "has-panel" : ""}`}>
        <div className="br-main">
          {view === "map" ? (
            <div className="map-frame br-map-frame">
              <MapContainer preferCanvas center={[-14.2, -51.9]} zoom={4} minZoom={3} style={{ height: "100%", width: "100%" }}>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapZoom onZoom={setZoom} />
                <ClusterLayer clusters={clusters} onSelect={setSelected} />
              </MapContainer>
              <div className="br-map-legend">
                <strong>Site intelligence</strong>
                <span><i className="active" /> active site</span>
                <span><i className="dormant" /> historical site</span>
                <span><i className="cluster" /> cluster · click to zoom</span>
                <small>{visible.length.toLocaleString("en-US")} in view · city-level coordinates</small>
              </div>
            </div>
          ) : (
            <div className="br-dataset">
              <div className="br-dataset__note">Showing the first 500 by number of active trials. Use the filters to refine the results.</div>
              <div className="br-table-scroll">
                <table>
                  <thead><tr><th>Site</th><th>State</th><th>Active</th><th>Historical</th><th>Sources</th><th>Maturity</th></tr></thead>
                  <tbody>{tableRows.map((site) => (
                    <tr key={site.site_id} onClick={() => setSelected(site)} className={selected?.site_id === site.site_id ? "selected" : ""}>
                      <td><strong>{site.name}</strong><small>{site.city ?? "City not reported"}</small></td>
                      <td>{site.uf ?? "—"}</td>
                      <td className="num">{site.active_trial_count}</td>
                      <td className="num">{site.trial_count}</td>
                      <td><div className="br-tag-row">{site.intelligence?.sources.slice(0, 3).map((source) => <SourceBadge key={source} source={source} />) ?? "—"}</div></td>
                      <td>{site.intelligence?.oncology === true ? "Oncology" : site.intelligence?.inspections.length ? "Declared inspection" : "Not enriched"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        {selected && <SiteDetailPanel site={selected} onClose={() => setSelected(null)} />}
      </div>

      {payload && <div className="br-freshness">Map: {new Date(payload.generated_at).toLocaleDateString("en-US")} · Facility master: {new Date(payload.master_generated_at).toLocaleDateString("en-US")} · Strict deduplication: {payload.dedup.input_sites.toLocaleString("en-US")} → {payload.dedup.output_sites.toLocaleString("en-US")}</div>}
    </div>
  );
}
