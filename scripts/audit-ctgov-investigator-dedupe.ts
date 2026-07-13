import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CtgovInvestigatorRoster } from "../src/lib/ctgov/investigatorRosterModel";
import { buildInvestigatorDedupeAudit } from "../src/lib/ctgov/investigatorDedupe";

function valueAfter(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const input = path.resolve(valueAfter("--input", "data/ctgov-investigators-br.json"));
  const output = path.resolve(valueAfter("--out", "data/ctgov-investigator-dedupe-audit.json"));
  const roster = JSON.parse(await readFile(input, "utf8")) as CtgovInvestigatorRoster;
  const audit = buildInvestigatorDedupeAudit(roster.investigators);
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ input, output, ...audit.summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
