/**
 * Build the slim /map payload from the SiteMapTool pipeline's full sites.json.
 * Usage: ./node_modules/.bin/tsx scripts/build-latam-map-data.ts <path-to-full-sites.json>
 * Keeps only mappable sites (non-null coords) and the fields the map renders.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = process.argv[2];
if (!src) {
  console.error("usage: build-latam-map-data.ts <path-to-full-sites.json>");
  process.exit(1);
}

interface FullSite {
  site_id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  activity_status: "active" | "dormant";
  trial_count: number;
  active_trial_count: number;
}

const full = JSON.parse(readFileSync(src, "utf8")) as { sites: FullSite[] };
const mappable = full.sites.filter((s) => s.lat != null && s.lng != null);
const sites = mappable.map((s) => ({
  site_id: s.site_id,
  name: s.name,
  city: s.city,
  state: s.state,
  country: s.country,
  lat: s.lat as number,
  lng: s.lng as number,
  activity_status: s.activity_status,
  trial_count: s.trial_count,
  active_trial_count: s.active_trial_count,
}));

mkdirSync("public/data", { recursive: true });
writeFileSync(
  "public/data/latam-sites.json",
  JSON.stringify({ generated_at: new Date().toISOString(), sites }),
);
console.log(
  `wrote public/data/latam-sites.json: ${sites.length} mappable sites ` +
    `(${full.sites.length - mappable.length} without coords excluded)`,
);
