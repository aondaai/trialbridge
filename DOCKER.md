# Running TrialBridge locally with Docker

Two services, one command: the **Next.js app** (`web`) and the **Python feasibility
estimator** (`estimator`, FastAPI + DuckDB over OMOP).

## Prerequisites
- Docker + Docker Compose v2.
- The estimator lives in the sibling directory `../outputs/trialbridge_estimator`
  (the compose file builds it from there). It must be present next to this repo,
  with its sample data at `data/omop_sample/` and `data/proprietary_ha/` — these are
  **baked into the estimator image** at build time. The 163GB `data/omop_full/` is
  excluded (see that dir's `.dockerignore`) and is **not** required.

## Start
```bash
# from this directory (trialbridge/)
docker compose up --build
```
Then open:
- **App:** http://localhost:3080  → start at http://localhost:3080/start
- **Estimator:** http://localhost:8421/health

> The app is mapped to host port **3080** (not 3000) because 3000 is often taken by
> other local services. Change the `web` port mapping in `docker-compose.yml` if you
> prefer another.

## What happens on boot
- `web` runs `prisma db push` against a **persistent named volume** (`tb-db`), so the
  SQLite database survives restarts. It starts **empty** — no seeded data. Create data
  by using the app (a sponsor posts a protocol; a site lists itself).
- `web` reaches the estimator at `http://estimator:8421` over the compose network. If
  the estimator is down, the sponsor's national card degrades gracefully.

## Optional: live Claude parsing
Protocol parsing falls back to a cached, verified fixture without a key. To enable live
parsing, export a **rotated** Anthropic key before `up`:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
docker compose up --build
```
(The key is passed through as an env var; it is never baked into the image.)

## Data note (honest)
The estimator runs on `omop_sample` (a small, real subset), so the national estimate can
be 0 while **Observed N** (direct count from the 14 proprietary hospitals) is real (~29).
The full national figure (~4,588 for the HER2+ hero protocol) needs `omop_full` — see
`../outputs/trialbridge_estimator/README.md`.

## Reset the database
```bash
docker compose down -v   # -v drops the tb-db volume → empty DB next start
```
