"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface LatamTrialSite {
  site_id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  lat: number;
  lng: number;
  activity_status: "active" | "dormant";
  trial_count: number;
  active_trial_count: number;
}

const COUNTRIES = [
  { iso2: "br", label: "Brazil" },
  { iso2: "mx", label: "Mexico" },
  { iso2: "cl", label: "Chile" },
  { iso2: "ar", label: "Argentina" },
];

const COLORS: Record<LatamTrialSite["activity_status"], string> = {
  active: "#16a34a",
  dormant: "#94a3b8",
};

export default function LatamSiteMap() {
  const [sites, setSites] = useState<LatamTrialSite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(COUNTRIES.map((c) => c.iso2)),
  );

  useEffect(() => {
    fetch("/data/latam-sites.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setSites(Array.isArray(d?.sites) ? d.sites : []))
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : String(e)),
      );
  }, []);

  const visible = useMemo(
    () => sites.filter((s) => enabled.has(s.country)),
    [sites, enabled],
  );

  function toggle(iso2: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(iso2)) next.delete(iso2);
      else next.add(iso2);
      return next;
    });
  }

  return (
    <div className="card map-card">
      <div className="map-controls">
        <div className="map-filters">
          {COUNTRIES.map((c) => (
            <label key={c.iso2} className="map-filter">
              <input
                type="checkbox"
                checked={enabled.has(c.iso2)}
                onChange={() => toggle(c.iso2)}
              />
              {c.label}
            </label>
          ))}
        </div>
        <div className="map-legend">
          <span className="map-count">{visible.length.toLocaleString()} sites</span>
          <span>
            <span style={{ color: COLORS.active }}>●</span> active
          </span>
          <span>
            <span style={{ color: COLORS.dormant }}>●</span> dormant
          </span>
        </div>
      </div>
      {loadError && (
        <p className="map-error">failed to load site data: {loadError}</p>
      )}
      <div className="map-frame">
        <MapContainer
          preferCanvas
          center={[-20, -65]}
          zoom={4}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visible.map((s) => (
            <CircleMarker
              key={s.site_id}
              center={[s.lat, s.lng]}
              radius={5}
              pathOptions={{
                color: COLORS[s.activity_status],
                fillColor: COLORS[s.activity_status],
                fillOpacity: 0.7,
                weight: 1,
              }}
            >
              <Popup>
                <strong>{s.name}</strong>
                <br />
                {[s.city, s.state].filter(Boolean).join(", ")}
                <br />
                {s.trial_count} trials ({s.active_trial_count} active)
                <br />
                <em>location approximate (city-level)</em>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
