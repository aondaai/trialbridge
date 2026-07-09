/**
 * Placeholder adapters for the two other backends DoctorAssistant's Tier 2
 * (row-level) pipeline might live on — Postgres/MySQL or BigQuery, per the
 * user's own answer that the exact backend isn't confirmed yet. Every
 * method throws `NotImplementedError`. The point of these stubs is that
 * picking the real one later is filling in a class against an already-
 * agreed interface (`OmopDataSource`), not redesigning it — delete
 * whichever one turns out not to be needed.
 */

import type { OmopCriterion } from "../types";
import type { AggregateQueryOptions, AggregateResult, OmopDataSource, RowLevelQueryOptions, OmopPatientEvaluation } from "./types";
import { NotImplementedError } from "./types";

export interface SqlConnectionConfig {
  connectionString: string;
  schema?: string;
}

export class PostgresOmopDataSource implements OmopDataSource {
  constructor(private config: SqlConnectionConfig) {}

  async queryAggregate(_criteria: OmopCriterion[], _opts?: AggregateQueryOptions): Promise<AggregateResult> {
    throw new NotImplementedError(
      "PostgresOmopDataSource.queryAggregate not implemented — confirm DoctorAssistant's backend before filling this in.",
    );
  }

  async queryRowLevel(_criteria: OmopCriterion[], _opts: RowLevelQueryOptions): Promise<OmopPatientEvaluation[]> {
    throw new NotImplementedError(
      "PostgresOmopDataSource.queryRowLevel not implemented — confirm DoctorAssistant's backend before filling this in.",
    );
  }
}

export interface BigQueryConnectionConfig {
  projectId: string;
  dataset: string;
}

export class BigQueryOmopDataSource implements OmopDataSource {
  constructor(private config: BigQueryConnectionConfig) {}

  async queryAggregate(_criteria: OmopCriterion[], _opts?: AggregateQueryOptions): Promise<AggregateResult> {
    throw new NotImplementedError(
      "BigQueryOmopDataSource.queryAggregate not implemented — confirm DoctorAssistant's backend before filling this in.",
    );
  }

  async queryRowLevel(_criteria: OmopCriterion[], _opts: RowLevelQueryOptions): Promise<OmopPatientEvaluation[]> {
    throw new NotImplementedError(
      "BigQueryOmopDataSource.queryRowLevel not implemented — confirm DoctorAssistant's backend before filling this in.",
    );
  }
}
