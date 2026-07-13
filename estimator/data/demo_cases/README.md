# NCT-specific demo data

Set `TB_DEMO_CASES_MANIFEST=/app/data/demo_cases/manifest.json` to enable strict
demo routing. In this mode only the seven NCT identifiers in `manifest.json` are
accepted (the two SOLAIRIA trials share one case).

Patient-level files and real captures belong under `private/`, which is ignored
by Git and excluded from the Docker build context. Docker Compose mounts that
directory read-only into the estimator.

Each case currently uses two aggregate files:

- `proprietary.json`: `ncts`, `shallow_n`, `full_n`, optional `by_payer`,
  `by_site`, `by_provider`, `source`, `as_of`, and `notes`.
- `datasus.json`: `ncts`, `by_uf` (`uf`, `base_cohort`), `source`, and `as_of`.

Copy the `.example.json` files into each case directory and replace the example
numbers. For a selected parquet instead, change the manifest source to
`{"type":"parquet","path":"private/<case>/*.parquet"}`. The host tool scans
only that glob; it never falls back to the full proprietary base while demo mode
is enabled.
