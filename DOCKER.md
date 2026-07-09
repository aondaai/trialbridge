# Running TrialBridge locally with Docker

Two services, one command: the **Next.js app** (`web`) and the **Python feasibility
estimator** (`estimator`, FastAPI + DuckDB over OMOP).

## Prerequisites
- Docker + Docker Compose v2. **That's it** — `git clone` + `docker compose up` works.

The estimator is vendored in-repo at [`estimator/`](estimator/), including the minimal
DataSUS sample it actually reads (`person` + `condition_occurrence`, ~61MB) and the
proprietary parquet (~268KB). These are **baked into the estimator image** at build
time — no external data or sibling directory needed. The 163GB `omop_full` is **not**
required (the estimator README documents how to point at it for the full national figure).

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
[`estimator/README.md`](estimator/README.md).

## Reset the database
```bash
docker compose down -v   # -v drops the tb-db volume → empty DB next start
```
