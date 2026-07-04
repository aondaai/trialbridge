# Deploying TrialBridge (so it "still runs the week after")

Two paths. **Use a persistent Node host (Railway/Render) — not Vercel** — because
the app *writes* to a JSON store on the filesystem (live proof-of-capacity submit,
posting a consultation). Vercel's serverless filesystem is read-only/ephemeral, so
those write paths would fail there. A persistent Node host keeps them working.

Prereqs: the repo builds clean (`npm run build`) and the seeded snapshot
(`data/*.json`) is committed, so a fresh host boots with the demo already populated.

---

## Path A — Railway / Render (recommended, ~10 min)

Runs the app exactly as-is off the committed JSON snapshot. Live submits and posts
persist for the life of the running instance (they reset to the seeded state on a
fresh deploy — re-run the seed if you want to reset mid-week).

1. Push the repo to GitHub.
2. **Railway:** New Project → Deploy from GitHub repo. **Render:** New → Web Service → connect the repo.
3. Set the service root to `trialbridge/` (this folder), and:
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm start`  (Next respects the `PORT` env var the host injects)
   - **Node version:** 22 (matches local)
4. Env vars:
   - `ANTHROPIC_API_KEY` = `sk-ant-...` — optional; enables the live Claude parse at `/sponsor/new`. Without it, parsing falls back to the cached verified criteria (labelled in the UI).
5. Deploy. The seeded hero consultation + sites B/C responses are already in `data/`, so `/sponsor` and `/site` work immediately.
6. **To reset demo state on the host** (clears live submits/posts back to the seeded snapshot): run `npm run db:seed` from the host shell, or redeploy.

> The `data/*.json` store is the "frozen demo snapshot." Because it's committed, every
> deploy is reproducible and identical — the property the ADR wanted from SQLite, with
> zero infra.

---

## Path B — Postgres swap (for a durable, multi-user product)

Do this only if you're continuing past the hackathon and want writes to survive
redeploys and concurrent users. The ADR designed for exactly this: the store is
behind a small interface and `prisma/schema.prisma` already models the same
counts-not-rows shape.

1. Provision Postgres (Railway/Render/Supabase all give a `DATABASE_URL`).
2. In `prisma/schema.prisma`, switch the datasource:
   ```prisma
   datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
   ```
3. `npx prisma migrate deploy` (or `prisma db push`) to create the tables.
4. Port `src/lib/store.ts` from the JSON file implementation to Prisma
   (`prisma.consultation.*` / `prisma.response.*`). The function signatures stay the
   same — `loadConsultations`, `loadResponses`, `upsertResponse`, etc. — so nothing
   above the store changes. Patient rows stay in `data/*.json` (they never enter the
   shared DB — that's the privacy boundary).
5. Seed: run the equivalent of `prisma/seed.ts` against Postgres.

Patients-in-Postgres and true federation are the v2 direction, not this swap.

---

## Sanity check after deploy

```
GET  /                       → landing (200)
GET  /sponsor                → aggregated view, 3 sites, <5 suppression
GET  /site                   → matcher over site A, Submit button
POST /site (submit)          → site A appears "live" on /sponsor
GET  /sponsor/new            → paste → parse → verify → post
```

If `/sponsor` shows "No consultation seeded," run `npm run db:seed` on the host.
