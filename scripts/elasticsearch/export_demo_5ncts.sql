-- Variables required from the DuckDB CLI:
--   SET VARIABLE parquet_glob = '/path/to/parquet_ihealth/*.parquet';
--   SET VARIABLE output_path = '/path/to/clinical-demo-5ncts-v1.jsonl';
--
-- The source contains multiple S3 snapshots. Keep the newest snapshot PER hospital;
-- the globally newest timestamp is only an incremental five-hospital dump.

COPY (
  WITH all_documents AS (
    SELECT *
    FROM read_parquet(getvariable('parquet_glob'))
  ),
  current_documents AS (
    SELECT document.*
    FROM all_documents document
    WHERE document.fonte = 's3_2026'
      AND document.dump_ts = (
        SELECT max(snapshot.dump_ts)
        FROM all_documents snapshot
        WHERE snapshot.fonte = 's3_2026'
          AND snapshot.hospital = document.hospital
      )
  ),
  normalized AS (
    SELECT *, upper(replace(primary_icd, '.', '')) AS icd
    FROM current_documents
    WHERE regexp_matches(
      upper(replace(primary_icd, '.', '')),
      '^(C50|C34|C16|C18|C19|C20|C67|C15|J84|C82|C83|C84|C85|C88|C91|C54|C56|C25)'
    )
  )
  SELECT
    md5(concat_ws('|', fonte, hospital, dump_ts, doc_id, unique_case_id)) AS _id,
    list_filter([
      CASE WHEN icd LIKE 'C50%' THEN 'NCT06982521' END,
      CASE WHEN regexp_matches(icd, '^(C50|C34|C16|C18|C19|C20|C67|C15)') THEN 'NCT06253871' END,
      CASE WHEN icd LIKE 'J84%' THEN 'NCT07687459' END,
      CASE WHEN regexp_matches(icd, '^(C82|C83|C84|C85|C88|C91)') THEN 'NCT05544019' END,
      CASE WHEN regexp_matches(icd, '^(C18|C19|C20|C54|C16|C56|C25)') THEN 'NCT06898450' END
    ], lambda nct: nct IS NOT NULL) AS candidate_ncts,
    'broad_primary_icd_cohort' AS candidate_basis,
    fonte AS source,
    hospital,
    strptime(dump_ts, '%Y%m%dT%H%M%SZ') AS dump_timestamp,
    doc_id AS document_id,
    unique_patient_id AS patient_id,
    unique_case_id AS case_id,
    gender,
    CASE
      WHEN birth_year BETWEEN 1900 AND year(current_date)
      THEN make_date(birth_year, 1, 1)
    END AS birthdate,
    'year' AS birthdate_precision,
    death,
    provider,
    cn_origin AS origin,
    encounter_type,
    convenio AS payer,
    primary_icd,
    created_ts AS created_at,
    ingested_ts AS ingested_at,
    struct_pack(
      entities := n_entidades,
      lab_tests := n_exames,
      vital_signs := n_sinais_vitais,
      biomarkers := n_biomarcadores,
      relations := n_relacoes
    ) AS nlp_counts,
    struct_pack(text := texto) AS preds
  FROM normalized
)
TO (getvariable('output_path')) (FORMAT JSON, ARRAY false);
