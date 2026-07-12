/**
 * CLI wrapper for the synthetic-data generator — writes the panel to data/*.json.
 *
 * The generator itself (deterministic, in-memory, no file I/O) lives in
 * src/lib/data/site-panel.ts so it can be bundled into the Next.js server for the
 * boot-time demo seed. This file keeps only the node:fs writing side, so the
 * server bundle never pulls in node builtins. Run with `npm run generate-data`.
 *
 * `generatePanel` is re-exported so existing importers (tests) that referenced it
 * from this path keep working.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePanel } from "../src/lib/data/site-panel";

export { generatePanel } from "../src/lib/data/site-panel";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const index: { id: string; name: string; country: string; city: string; region: string; persona: string; monthlyIncidence: number; count: number; file: string }[] = [];

  for (const { site, patients } of generatePanel()) {

    const file = `${site.id}.json`;
    const payload = {
      site: {
        id: site.id,
        name: site.name,
        country: site.country,
        city: site.city,
        region: site.region,
        persona: site.persona,
        monthlyIncidence: site.monthlyIncidence,
      },
      generatedWith: { generator: "programmatic-mulberry32", note: "population calibrated to breast-oncology epidemiology; NOT fit to protocol criteria" },
      patients,
    };
    writeFileSync(resolve(DATA_DIR, file), JSON.stringify(payload, null, 2) + "\n");

    // quick summary
    const her2Missing = patients.filter((p) => p.biomarkers.her2_status == null).length;
    const her2Pos = patients.filter((p) => p.biomarkers.her2_status === "positive").length;
    index.push({ id: site.id, name: site.name, country: site.country, city: site.city, region: site.region, persona: site.persona, monthlyIncidence: site.monthlyIncidence, count: patients.length, file });
    console.log(
      `${site.id}: ${patients.length} patients | HER2 missing ${her2Missing} (${Math.round((100 * her2Missing) / patients.length)}%) | HER2+ ${her2Pos}`,
    );

    const lungPatients = patients.filter((p) => p.diagnosis === "lung cancer");
    const krasMissing = lungPatients.filter((p) => p.biomarkers.kras_g12c == null).length;
    const pdl1Missing = lungPatients.filter((p) => p.biomarkers.pdl1_status == null).length;
    console.log(
      `  lung=${lungPatients.length} | KRAS untested ${krasMissing} (${lungPatients.length ? Math.round((100 * krasMissing) / lungPatients.length) : 0}%) | PD-L1 untested ${pdl1Missing} (${lungPatients.length ? Math.round((100 * pdl1Missing) / lungPatients.length) : 0}%)`,
    );
  }

  writeFileSync(resolve(DATA_DIR, "index.json"), JSON.stringify({ sites: index }, null, 2) + "\n");
  console.log(`\nWrote ${index.length} site datasets + index.json to data/`);
}

// Only write files when run directly as a script (`npm run generate-data`),
// not when imported for its generatePanel() re-export (e.g. by tests).
if (process.argv[1] && /generate-data\.ts$/.test(process.argv[1])) main();
