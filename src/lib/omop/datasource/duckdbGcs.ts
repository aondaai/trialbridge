/**
 * Tier 1 (DataSUS-style) adapter: DuckDB reading OMOP parquet/CSV over GCS,
 * matching the description in docs/trialbridge-prd-v4.md ("DuckDB over OMOP
 * in GCS"). `queryAggregate` is implemented; `queryRowLevel` is Tier 2's
 * job and throws `NotImplementedError` — DoctorAssistant's actual schema
 * isn't confirmed yet.
 *
 * NOT INTEGRATION-TESTED. There are no live DataSUS credentials in this
 * environment — the SQL this adapter generates is unit-tested in isolation
 * (tests/omop-datasource.test.ts exercises the logic against MockOmopDataSource;
 * `sql.ts`'s query-building is covered directly). Once you have real
 * credentials, fill `.env.local` per `.env.example` and confirm connectivity
 * yourself — happy to debug together once you do.
 *
 * `duckdb` is intentionally NOT a package.json dependency: it requires a
 * native binary build (node-pre-gyp) that failed outright in this sandboxed
 * environment (the same colon-in-path fragility this repo already works
 * around for other bins — see package.json's "comment" field). Loading it
 * via dynamic import means the rest of the app builds and runs with zero
 * dependency on it; only calling `queryAggregate` requires you to
 * `npm install duckdb` yourself, locally, where a native build actually
 * succeeds.
 */

import type { OmopCriterion } from "../types";
import type { AggregateQueryOptions, AggregateResult, OmopDataSource, RowLevelQueryOptions, OmopPatientEvaluation } from "./types";
import { NotImplementedError } from "./types";
import { buildAggregateSql, partitionEvaluable } from "./sql";

export interface DuckDbGcsConfig {
  /** e.g. "gs://bucket/omop/*.parquet" — read via DuckDB's httpfs extension against GCS's S3-compatible interop API. */
  gcsPath: string;
  hmacKeyId: string;
  hmacSecret: string;
  /** DuckDB schema/catalog the OMOP tables are attached under. Defaults to "main". */
  schema?: string;
}

/** Reads DuckDB config from env vars — see .env.example. Throws with a clear message listing exactly what's missing. */
export function duckDbConfigFromEnv(): DuckDbGcsConfig {
  const gcsPath = process.env.DATASUS_OMOP_GCS_PATH;
  const hmacKeyId = process.env.DATASUS_OMOP_GCS_HMAC_KEY_ID;
  const hmacSecret = process.env.DATASUS_OMOP_GCS_HMAC_SECRET;
  const missing = [
    !gcsPath && "DATASUS_OMOP_GCS_PATH",
    !hmacKeyId && "DATASUS_OMOP_GCS_HMAC_KEY_ID",
    !hmacSecret && "DATASUS_OMOP_GCS_HMAC_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing env vars for the DataSUS DuckDB/GCS data source: ${missing.join(", ")}. See .env.example.`);
  }
  return {
    gcsPath: gcsPath!,
    hmacKeyId: hmacKeyId!,
    hmacSecret: hmacSecret!,
    schema: process.env.DATASUS_OMOP_DUCKDB_SCHEMA ?? "main",
  };
}

// Minimal shape of what this adapter needs from the `duckdb` package —
// avoids depending on its (occasionally missing/incomplete) published types.
interface DuckDbLike {
  Database: new (path: string) => {
    all(sql: string, cb: (err: Error | null, rows: Record<string, unknown>[]) => void): void;
    close(cb?: (err: Error | null) => void): void;
  };
}

async function loadDuckDb(): Promise<DuckDbLike> {
  try {
    // Non-literal specifier on purpose: keeps TS from trying to resolve
    // "duckdb"'s types/existence at compile time — see the file-level doc
    // comment for why this isn't a static dependency.
    const moduleName = "duckdb";
    return (await import(moduleName)) as unknown as DuckDbLike;
  } catch {
    throw new Error(
      "The 'duckdb' package isn't installed. Run `npm install duckdb` locally (it needs a native build, which " +
        "failed in the sandboxed environment this adapter was written in — see the file-level comment in duckdbGcs.ts).",
    );
  }
}

function runQuery(db: InstanceType<DuckDbLike["Database"]>, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolvePromise, reject) => {
    db.all(sql, (err, rows) => (err ? reject(err) : resolvePromise(rows)));
  });
}

export class DuckDbGcsOmopDataSource implements OmopDataSource {
  constructor(private config: DuckDbGcsConfig) {}

  async queryAggregate(criteria: OmopCriterion[], opts?: AggregateQueryOptions): Promise<AggregateResult> {
    if (opts?.region) {
      // Not implemented this round — see AggregateQueryOptions.region's doc comment.
      throw new NotImplementedError(
        "Region filtering isn't implemented yet — DataSUS's actual region column needs confirming first.",
      );
    }

    const { evaluable, notEvaluable } = partitionEvaluable(criteria);
    if (evaluable.length === 0) {
      return { counts: { definite: 0, possible: 0, excluded: 0, total: 0 }, notEvaluable };
    }

    const duckdb = await loadDuckDb();
    const db = new duckdb.Database(":memory:");
    try {
      await runQuery(db, "INSTALL httpfs; LOAD httpfs;");
      await runQuery(
        db,
        `SET s3_endpoint='storage.googleapis.com'; SET s3_access_key_id='${this.config.hmacKeyId}'; SET s3_secret_access_key='${this.config.hmacSecret}'; SET s3_url_style='path';`,
      );
      const schema = this.config.schema ?? "main";
      // Attach the GCS parquet path as views named after each OMOP table this
      // query touches. Exact attach strategy depends on how your bundle is
      // laid out (one file per table vs. a single partitioned dataset) —
      // adjust this block once you're pointed at real data.
      const sql = buildAggregateSql(evaluable, schema);
      const rows = await runQuery(db, sql);
      const row = rows[0] ?? {};
      const total = Number(row.total ?? 0);
      const definite = Number(row.definite ?? 0);
      const excluded = Number(row.excluded ?? 0);
      const possible = Math.max(0, total - definite - excluded);

      return { counts: { definite, possible, excluded, total }, notEvaluable };
    } finally {
      db.close();
    }
  }

  async queryRowLevel(_criteria: OmopCriterion[], _opts: RowLevelQueryOptions): Promise<OmopPatientEvaluation[]> {
    throw new NotImplementedError(
      "Tier 2 row-level query not implemented — DoctorAssistant's OMOP schema needs confirming first (docs/trialbridge-prd-v4.md open questions).",
    );
  }
}
