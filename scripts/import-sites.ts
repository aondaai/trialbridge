/**
 * Import the ABRACRO + ACESSE research-centre spreadsheets into a normalized site
 * directory (data/site-directory.json — gitignored; contains contact details).
 *
 *   npm run import-sites -- "<abracro.xlsx>" "<acesse.xlsx>"
 *
 * Defaults to the files in ~/Downloads if no args are given. Uses the repo's own
 * dependency-free XLSX reader.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { xlsxRows } from "@/lib/intake/adapters/xlsx";
import { parseAbracro, parseAcesse, mergeDirectory, directoryStats } from "@/lib/sites/directory";

const OUT = "data/site-directory.json";

function rows(path: string): string[][] {
  return xlsxRows(new Uint8Array(readFileSync(path)));
}

function main() {
  const dl = `${homedir()}/Downloads`;
  const abracroPath = process.argv[2] ?? `${dl}/ABRACRO_Planilha de Centros de Pesquisa_28Jan2025.xlsx`;
  const acessePath = process.argv[3] ?? `${dl}/Associados ACESSE - Controle de Centros (1).xlsx`;

  const abracro = parseAbracro(rows(abracroPath));
  const acesse = parseAcesse(rows(acessePath));
  console.log(`[import-sites] parsed ABRACRO=${abracro.length} ACESSE=${acesse.length} (pre-dedupe)`);

  const directory = mergeDirectory(abracro, acesse);
  const stats = directoryStats(directory);

  mkdirSync("data", { recursive: true });
  writeFileSync(OUT, JSON.stringify(directory, null, 2));

  console.log(`[import-sites] wrote ${directory.length} unique sites -> ${OUT}`);
  console.log("  with CNES:      ", stats.withCnes);
  console.log("  oncology sites: ", stats.oncology);
  console.log("  ANVISA-inspected:", stats.anvisaInspected);
  console.log("  with region:    ", stats.withRegion);
  console.log("  by region:      ", JSON.stringify(stats.byRegion));
  console.log("  by source:      ", JSON.stringify(stats.bySource));
  console.log("\n  sample oncology sites with CNES:");
  directory
    .filter((s) => s.oncology && s.cnes)
    .slice(0, 6)
    .forEach((s) => console.log(`   - ${s.name} (CNES ${s.cnes}, ${s.uf ?? "?"}/${s.region ?? "?"}) inspections:${JSON.stringify(s.inspections)}`));
}

main();
